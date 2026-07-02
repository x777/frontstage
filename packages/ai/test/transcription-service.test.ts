import { describe, expect, test } from "vitest";
import type { MediaManifestEntry, TranscriptRecord } from "@palmier/core";
import type { GenJobGateway, JobStatus } from "../src/generation/gen-gateway.js";
import { TranscriptionService } from "../src/transcription/transcription-service.js";
import type { AudioExtractor, TranscriptionHost } from "../src/transcription/transcription-service.js";

function makeEntry(overrides: Partial<MediaManifestEntry> = {}): MediaManifestEntry {
  return {
    id: "m1",
    name: "clip.mp4",
    type: "video",
    source: { kind: "project", relativePath: "media/m1.mp4" },
    duration: 10,
    ...overrides,
  };
}

function makeHost(seedEntries: MediaManifestEntry[] = [], preset: Record<string, Uint8Array> = {}) {
  const store = new Map(seedEntries.map((e) => [e.id, e]));
  const derived = new Map(Object.entries(preset));
  const writes: { path: string; bytes: Uint8Array }[] = [];
  const patches: { id: string; patch: Partial<MediaManifestEntry> }[] = [];
  const readDerivedCalls: string[] = [];
  const host: TranscriptionHost = {
    entries: () => [...store.values()],
    patchEntry: (id, patch) => {
      patches.push({ id, patch });
      const existing = store.get(id);
      if (existing) store.set(id, { ...existing, ...patch });
    },
    writeDerived: (path, bytes) => {
      writes.push({ path, bytes });
      derived.set(path, bytes);
    },
    readDerived: async (path) => {
      readDerivedCalls.push(path);
      return derived.get(path) ?? null;
    },
  };
  return { host, store, writes, patches, readDerivedCalls };
}

function makeGateway(opts: {
  statuses?: JobStatus[];
  submit?: () => Promise<{ jobId: string }>;
  submitJobId?: (input: Record<string, unknown>) => string;
  statusFor?: (jobId: string) => JobStatus;
  uploadFile?: (bytes: Uint8Array, contentType: string, fileName: string) => Promise<string>;
  hasKey?: () => Promise<boolean>;
}) {
  const calls = { submit: 0, upload: 0, status: 0 };
  let statusIndex = 0;
  const gateway: GenJobGateway = {
    async submitJob(_modelEndpoint, input) {
      calls.submit++;
      if (opts.submit) return opts.submit();
      const jobId = opts.submitJobId ? opts.submitJobId(input) : "job-1";
      return { jobId };
    },
    async jobStatus(_modelEndpoint, jobId) {
      calls.status++;
      if (opts.statusFor) return opts.statusFor(jobId);
      const seq = opts.statuses ?? [{ status: "succeeded" as const, resultJson: { text: "", chunks: [], languages: [] } }];
      const status = seq[Math.min(statusIndex, seq.length - 1)]!;
      statusIndex++;
      return status;
    },
    async downloadResult() {
      throw new Error("downloadResult not used by TranscriptionService");
    },
    async uploadFile(bytes, contentType, fileName) {
      calls.upload++;
      if (opts.uploadFile) return opts.uploadFile(bytes, contentType, fileName);
      return "https://v3.fal.media/files/uploaded.wav";
    },
    async hasKey() {
      return opts.hasKey ? opts.hasKey() : true;
    },
  };
  return { gateway, calls };
}

const NO_DELAY = { sleep: async () => {}, pollDelay: () => 0 };

describe("TranscriptionService.transcribe: cache-first", () => {
  test("cache hit: transcriptPath set + a valid cache record -> returns the full result, no gateway/extract calls at all", async () => {
    const record: TranscriptRecord = {
      text: "hello world",
      language: "en",
      words: [{ text: "hello", start: 0, end: 0.5 }, { text: "world", start: 0.5, end: 1 }],
      segments: [{ text: "hello world", start: 0, end: 1 }],
      sourceDurationSeconds: 10,
      model: "fal-ai/wizper",
    };
    const path = "media/m1.transcript.json";
    const entry = makeEntry({ transcriptPath: path });
    const { host, patches } = makeHost([entry], { [path]: new TextEncoder().encode(JSON.stringify(record)) });
    const { gateway, calls } = makeGateway({});
    let extractCalls = 0;
    const extract: AudioExtractor = async () => { extractCalls++; return { wav: new Uint8Array(), durationSeconds: 0 }; };
    const service = new TranscriptionService(gateway, host, extract);

    const result = await service.transcribe("m1");

    expect(result).toEqual({ text: record.text, language: record.language, words: record.words, segments: record.segments });
    expect(calls.submit).toBe(0);
    expect(calls.upload).toBe(0);
    expect(calls.status).toBe(0);
    expect(extractCalls).toBe(0);
    expect(patches).toHaveLength(0);
  });

  test("corrupt cache (unparseable bytes) falls through to a fresh miss flow, not a throw", async () => {
    const path = "media/m1.transcript.json";
    const entry = makeEntry({ transcriptPath: path });
    const { host, writes } = makeHost([entry], { [path]: new TextEncoder().encode("not json") });
    const { gateway, calls } = makeGateway({
      statuses: [{ status: "succeeded", resultJson: { text: "fresh", chunks: [{ text: "fresh", timestamp: [0, 1] }], languages: [] } }],
    });
    const extract: AudioExtractor = async () => ({ wav: new Uint8Array([1]), durationSeconds: 3 });
    const service = new TranscriptionService(gateway, host, extract, NO_DELAY);

    const result = await service.transcribe("m1");

    expect(result.text).toBe("fresh");
    expect(calls.submit).toBe(1);
    expect(writes).toHaveLength(1);
  });
});

describe("TranscriptionService.transcribe: miss happy path", () => {
  test("status transitions transcribing -> cleared, the record lands at the right path with correct content", async () => {
    const entry = makeEntry();
    const { host, patches, writes, store } = makeHost([entry]);
    const resultJson = { text: "hi there", chunks: [{ text: "hi there", timestamp: [0, 1] }], languages: ["en"] };
    const { gateway, calls } = makeGateway({
      statuses: [{ status: "queued" }, { status: "running" }, { status: "succeeded", resultJson }],
    });
    const extract: AudioExtractor = async () => ({ wav: new Uint8Array([9, 9]), durationSeconds: 12 });
    const service = new TranscriptionService(gateway, host, extract, NO_DELAY);

    const result = await service.transcribe("m1");

    expect(result.text).toBe("hi there");
    expect(calls.submit).toBe(1);
    expect(calls.upload).toBe(1);
    expect(calls.status).toBe(3);

    const statusPatches = patches.filter((p) => "generationStatus" in p.patch).map((p) => p.patch.generationStatus);
    expect(statusPatches[0]).toBe("transcribing");
    expect(statusPatches[statusPatches.length - 1]).toBeUndefined();

    expect(writes).toHaveLength(1);
    expect(writes[0]!.path).toBe("media/m1.transcript.json");
    const record = JSON.parse(new TextDecoder().decode(writes[0]!.bytes));
    expect(record).toEqual({
      text: "hi there",
      language: "en",
      words: [
        { text: "hi", start: 0, end: 0.5 },
        { text: "there", start: 0.5, end: 1 },
      ],
      segments: [{ text: "hi there", start: 0, end: 1 }],
      sourceDurationSeconds: 12,
      model: "fal-ai/wizper",
    });

    const final = store.get("m1")!;
    expect(final.transcriptPath).toBe("media/m1.transcript.json");
    expect(final.generationStatus).toBeUndefined();
  });

  test("uploads the extracted WAV as audio/wav and submits fal-ai/wizper with the fal-fetchable URL", async () => {
    const entry = makeEntry();
    const { host } = makeHost([entry]);
    const uploadCalls: { bytes: Uint8Array; contentType: string; fileName: string }[] = [];
    const submittedInputs: Record<string, unknown>[] = [];
    const { gateway } = makeGateway({
      uploadFile: async (bytes, contentType, fileName) => {
        uploadCalls.push({ bytes, contentType, fileName });
        return "https://v3.fal.media/files/m1.wav";
      },
      statuses: [{ status: "succeeded", resultJson: { text: "hi", chunks: [{ text: "hi", timestamp: [0, 1] }], languages: [] } }],
    });
    const originalSubmit = gateway.submitJob.bind(gateway);
    gateway.submitJob = async (endpoint, input) => { submittedInputs.push(input); return originalSubmit(endpoint, input); };
    const extract: AudioExtractor = async () => ({ wav: new Uint8Array([1, 2, 3]), durationSeconds: 5 });
    const service = new TranscriptionService(gateway, host, extract, NO_DELAY);

    await service.transcribe("m1");

    expect(uploadCalls[0]!.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(uploadCalls[0]!.contentType).toBe("audio/wav");
    expect(submittedInputs[0]).toMatchObject({ audio_url: "https://v3.fal.media/files/m1.wav", task: "transcribe" });
  });
});

describe("TranscriptionService.transcribe: language override", () => {
  test("bypasses the cache entirely: no read despite a cached transcriptPath, and no write afterward", async () => {
    const path = "media/m1.transcript.json";
    const staleRecord: TranscriptRecord = { text: "stale", words: [], segments: [], sourceDurationSeconds: 1, model: "fal-ai/wizper" };
    const entry = makeEntry({ transcriptPath: path });
    const { host, writes, readDerivedCalls, store } = makeHost([entry], { [path]: new TextEncoder().encode(JSON.stringify(staleRecord)) });
    const resultJson = { text: "french hi", chunks: [{ text: "french hi", timestamp: [0, 1] }], languages: ["fr"] };
    const { gateway } = makeGateway({ statuses: [{ status: "succeeded", resultJson }] });
    const extract: AudioExtractor = async () => ({ wav: new Uint8Array([1]), durationSeconds: 2 });
    const service = new TranscriptionService(gateway, host, extract, NO_DELAY);

    const result = await service.transcribe("m1", { language: "fr" });

    expect(result.text).toBe("french hi");
    expect(readDerivedCalls).toHaveLength(0);
    expect(writes).toHaveLength(0);

    const final = store.get("m1")!;
    expect(final.transcriptPath).toBe(path); // untouched — still the old cached value
    expect(final.generationStatus).toBeUndefined(); // status still clears
  });

  test("passes language through to buildInput", async () => {
    const entry = makeEntry();
    const { host } = makeHost([entry]);
    const submittedInputs: Record<string, unknown>[] = [];
    const { gateway } = makeGateway({
      statuses: [{ status: "succeeded", resultJson: { text: "hi", chunks: [{ text: "hi", timestamp: [0, 1] }], languages: [] } }],
    });
    const originalSubmit = gateway.submitJob.bind(gateway);
    gateway.submitJob = async (endpoint, input) => { submittedInputs.push(input); return originalSubmit(endpoint, input); };
    const extract: AudioExtractor = async () => ({ wav: new Uint8Array([1]), durationSeconds: 2 });
    const service = new TranscriptionService(gateway, host, extract, NO_DELAY);

    await service.transcribe("m1", { language: "fr" });

    expect(submittedInputs[0]).toMatchObject({ language: "fr" });
  });
});

describe("TranscriptionService.transcribe: failures", () => {
  test("submit failure -> patches 'failed: <msg>' and rethrows; no cache write", async () => {
    const entry = makeEntry();
    const { host, writes, store } = makeHost([entry]);
    const { gateway } = makeGateway({ submit: async () => { throw new Error("boom"); } });
    const extract: AudioExtractor = async () => ({ wav: new Uint8Array([1]), durationSeconds: 2 });
    const service = new TranscriptionService(gateway, host, extract, NO_DELAY);

    await expect(service.transcribe("m1")).rejects.toThrow("boom");

    expect(writes).toHaveLength(0);
    expect(store.get("m1")!.generationStatus).toBe("failed: boom");
  });

  test("extraction failure -> patches 'failed: <msg>' and rethrows; no upload/submit", async () => {
    const entry = makeEntry();
    const { host, store } = makeHost([entry]);
    const { gateway, calls } = makeGateway({});
    const extract: AudioExtractor = async () => { throw new Error("ffmpeg exited 1"); };
    const service = new TranscriptionService(gateway, host, extract, NO_DELAY);

    await expect(service.transcribe("m1")).rejects.toThrow("ffmpeg exited 1");

    expect(calls.upload).toBe(0);
    expect(calls.submit).toBe(0);
    expect(store.get("m1")!.generationStatus).toBe("failed: ffmpeg exited 1");
  });

  test("a terminal 'failed' job status -> patches 'failed: <msg>' and rethrows", async () => {
    const entry = makeEntry();
    const { host, store } = makeHost([entry]);
    const { gateway } = makeGateway({ statuses: [{ status: "failed", errorMessage: "wizper exploded" }] });
    const extract: AudioExtractor = async () => ({ wav: new Uint8Array([1]), durationSeconds: 2 });
    const service = new TranscriptionService(gateway, host, extract, NO_DELAY);

    await expect(service.transcribe("m1")).rejects.toThrow("wizper exploded");
    expect(store.get("m1")!.generationStatus).toBe("failed: wizper exploded");
  });

  test("a succeeded status with no resultJson payload -> a defined failure, not a silent crash", async () => {
    const entry = makeEntry();
    const { host, store } = makeHost([entry]);
    const { gateway } = makeGateway({ statuses: [{ status: "succeeded", resultUrls: [] }] });
    const extract: AudioExtractor = async () => ({ wav: new Uint8Array([1]), durationSeconds: 2 });
    const service = new TranscriptionService(gateway, host, extract, NO_DELAY);

    await expect(service.transcribe("m1")).rejects.toThrow(/no result payload/);
    expect(store.get("m1")!.generationStatus).toMatch(/^failed: /);
  });

  test("an unknown mediaRef throws immediately, without touching the gateway", async () => {
    const { host } = makeHost([]);
    const { gateway, calls } = makeGateway({});
    const extract: AudioExtractor = async () => ({ wav: new Uint8Array(), durationSeconds: 0 });
    const service = new TranscriptionService(gateway, host, extract, NO_DELAY);

    await expect(service.transcribe("nope")).rejects.toThrow(/media not found/);
    expect(calls.submit).toBe(0);
  });
});

describe("TranscriptionService.transcribeMany", () => {
  test("parallel over unique refs, settles success/error independently, collapses duplicate refs", async () => {
    const a = makeEntry({ id: "a" });
    const b = makeEntry({ id: "b" });
    const c = makeEntry({ id: "c" });
    const { host } = makeHost([a, b, c]);
    const extract: AudioExtractor = async (mediaRef) => ({ wav: new TextEncoder().encode(mediaRef), durationSeconds: 1 });
    const { gateway, calls } = makeGateway({
      uploadFile: async (bytes) => "https://fake/" + new TextDecoder().decode(bytes),
      submitJobId: (input) => "job:" + (input as { audio_url: string }).audio_url,
      statusFor: (jobId) => {
        const ref = jobId.replace("job:https://fake/", "");
        if (ref === "c") return { status: "failed", errorMessage: "wizper exploded" };
        return { status: "succeeded", resultJson: { text: `hi ${ref}`, chunks: [{ text: `hi ${ref}`, timestamp: [0, 1] }], languages: [] } };
      },
    });
    const service = new TranscriptionService(gateway, host, extract, NO_DELAY);

    const results = await service.transcribeMany(["a", "b", "a", "c"]);

    expect(calls.submit).toBe(3); // a, b, c — the duplicate "a" collapses
    expect(results).toHaveLength(3);
    const byRef = new Map(results.map((r) => [r.ref, r]));
    expect(byRef.get("a")?.result?.text).toBe("hi a");
    expect(byRef.get("b")?.result?.text).toBe("hi b");
    expect(byRef.get("c")?.error).toBe("wizper exploded");
    expect(byRef.get("c")?.result).toBeUndefined();
  });

  test("empty refs -> empty results, no gateway calls", async () => {
    const { host } = makeHost([]);
    const { gateway, calls } = makeGateway({});
    const extract: AudioExtractor = async () => ({ wav: new Uint8Array(), durationSeconds: 0 });
    const service = new TranscriptionService(gateway, host, extract, NO_DELAY);

    expect(await service.transcribeMany([])).toEqual([]);
    expect(calls.submit).toBe(0);
  });
});

describe("TranscriptionService: in-flight dedupe", () => {
  test("two concurrent transcribe() calls for the same ref share ONE extract/upload/submit and resolve to equal results", async () => {
    const entry = makeEntry();
    const { host } = makeHost([entry]);
    let extractCalls = 0;
    const extract: AudioExtractor = async () => {
      extractCalls++;
      await new Promise((r) => setTimeout(r, 0));
      return { wav: new Uint8Array([1]), durationSeconds: 2 };
    };
    const { gateway, calls } = makeGateway({
      statuses: [{ status: "succeeded", resultJson: { text: "hi", chunks: [{ text: "hi", timestamp: [0, 1] }], languages: [] } }],
    });
    const service = new TranscriptionService(gateway, host, extract, NO_DELAY);

    const [r1, r2] = await Promise.all([service.transcribe("m1"), service.transcribe("m1")]);

    expect(extractCalls).toBe(1);
    expect(calls.upload).toBe(1);
    expect(calls.submit).toBe(1);
    expect(r1).toEqual(r2);
  });

  test("dedupe is per (mediaRef, language) — different language overrides do NOT share a run", async () => {
    const entry = makeEntry();
    const { host } = makeHost([entry]);
    const extract: AudioExtractor = async () => ({ wav: new Uint8Array([1]), durationSeconds: 2 });
    const { gateway, calls } = makeGateway({
      statusFor: () => ({ status: "succeeded", resultJson: { text: "hi", chunks: [{ text: "hi", timestamp: [0, 1] }], languages: [] } }),
    });
    const service = new TranscriptionService(gateway, host, extract, NO_DELAY);

    await Promise.all([service.transcribe("m1"), service.transcribe("m1", { language: "fr" })]);

    expect(calls.submit).toBe(2);
  });

  test("the in-flight entry is released after settling — a later call runs fresh, not reusing a stale promise", async () => {
    const entry = makeEntry();
    const { host } = makeHost([entry]);
    const extract: AudioExtractor = async () => ({ wav: new Uint8Array([1]), durationSeconds: 2 });
    const { gateway, calls } = makeGateway({
      statusFor: () => ({ status: "succeeded", resultJson: { text: "hi", chunks: [{ text: "hi", timestamp: [0, 1] }], languages: [] } }),
    });
    const service = new TranscriptionService(gateway, host, extract, NO_DELAY);

    await service.transcribe("m1", { language: "fr" });
    await service.transcribe("m1", { language: "fr" });

    expect(calls.submit).toBe(2);
  });
});

describe("TranscriptionService.cachedTranscript", () => {
  test("returns the cached full result without touching the gateway or extractor", async () => {
    const record: TranscriptRecord = { text: "hi", language: "en", words: [], segments: [], sourceDurationSeconds: 1, model: "fal-ai/wizper" };
    const path = "media/m1.transcript.json";
    const entry = makeEntry({ transcriptPath: path });
    const { host } = makeHost([entry], { [path]: new TextEncoder().encode(JSON.stringify(record)) });
    const { gateway, calls } = makeGateway({});
    let extractCalls = 0;
    const extract: AudioExtractor = async (ref) => { void ref; extractCalls++; return { wav: new Uint8Array(), durationSeconds: 0 }; };
    const service = new TranscriptionService(gateway, host, extract);

    const result = await service.cachedTranscript("m1");

    expect(result).toEqual({ text: "hi", language: "en", words: [], segments: [] });
    expect(calls.submit).toBe(0);
    expect(extractCalls).toBe(0);
  });

  test("null when there's no transcriptPath", async () => {
    const { host } = makeHost([makeEntry()]);
    const { gateway } = makeGateway({});
    const service = new TranscriptionService(gateway, host, async () => ({ wav: new Uint8Array(), durationSeconds: 0 }));
    expect(await service.cachedTranscript("m1")).toBeNull();
  });

  test("null (not a throw, not a transcribe) when the cache path is unreadable", async () => {
    const entry = makeEntry({ transcriptPath: "media/m1.transcript.json" });
    const { host } = makeHost([entry]);
    const { gateway, calls } = makeGateway({});
    const service = new TranscriptionService(gateway, host, async () => ({ wav: new Uint8Array(), durationSeconds: 0 }));
    expect(await service.cachedTranscript("m1")).toBeNull();
    expect(calls.submit).toBe(0);
  });

  test("null for an unknown mediaRef", async () => {
    const { host } = makeHost([]);
    const { gateway } = makeGateway({});
    const service = new TranscriptionService(gateway, host, async () => ({ wav: new Uint8Array(), durationSeconds: 0 }));
    expect(await service.cachedTranscript("nope")).toBeNull();
  });
});

describe("TranscriptionService.estimateCredits / hasKey", () => {
  test("estimateCredits delegates to the wizper catalog entry's audioPerSecond pricing", () => {
    const { host } = makeHost([]);
    const { gateway } = makeGateway({});
    const service = new TranscriptionService(gateway, host, async () => ({ wav: new Uint8Array(), durationSeconds: 0 }));
    // 0.01 credits/s * 250s = 2.5 -> ceil 3.
    expect(service.estimateCredits(250)).toBe(3);
  });

  test("hasKey passes through to the gateway", async () => {
    const { host } = makeHost([]);
    const { gateway } = makeGateway({ hasKey: async () => false });
    const service = new TranscriptionService(gateway, host, async () => ({ wav: new Uint8Array(), durationSeconds: 0 }));
    expect(await service.hasKey()).toBe(false);
  });
});
