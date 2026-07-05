import { describe, expect, test, vi } from "vitest";
import type { MediaManifestEntry, TranscriptRecord } from "@frontstage/core";
import { encodeWavPcm16Mono } from "@frontstage/engine/audio/wav-encode.js";
import type { GenJobGateway, JobStatus } from "../src/generation/gen-gateway.js";
import { TranscriptionService } from "../src/transcription/transcription-service.js";
import type { AudioExtractor, TranscriptionHost } from "../src/transcription/transcription-service.js";
import { LocalAsrService } from "../src/transcription/local-asr.js";
import type { LocalAsrPipelines, RawLocalTranscript } from "../src/transcription/local-asr.js";

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
      const seq = opts.statuses ?? [{ status: "succeeded" as const, resultJson: { text: "", chunks: [], inferred_languages: [] } }];
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

/** A LocalAsrService already in the "ready" state, with an instrumented transcribe(). */
async function makeReadyLocal(
  transcribeImpl?: LocalAsrPipelines["transcribe"],
): Promise<{ local: LocalAsrService; transcribe: ReturnType<typeof vi.fn> }> {
  const transcribe = vi.fn(
    transcribeImpl ?? (async (): Promise<RawLocalTranscript> => ({ text: "local hi", words: [{ text: "local", start: 0, end: 0.5 }] })),
  );
  const local = new LocalAsrService({
    loadPipelines: async () => ({ transcribe }),
    info: { model: "whisper-base", modelVersion: "onnx-community/whisper-base" },
  });
  await local.ensureReady();
  return { local, transcribe };
}

function makeIdleLocal(): LocalAsrService {
  return new LocalAsrService({
    loadPipelines: () => new Promise(() => {}), // never resolves -> stays idle unless ensureReady() is called
    info: { model: "whisper-base", modelVersion: "onnx-community/whisper-base" },
  });
}

async function makeFailedLocal(): Promise<LocalAsrService> {
  const local = new LocalAsrService({
    loadPipelines: async () => {
      throw new Error("download failed");
    },
    info: { model: "whisper-base", modelVersion: "onnx-community/whisper-base" },
  });
  await local.ensureReady().catch(() => {});
  return local;
}

const SIXTEEN_KHZ_WAV = encodeWavPcm16Mono(new Float32Array([0.1, 0.2, -0.1, 0]), 16000, 16000);

describe("TranscriptionService.transcribe: the provider seam", () => {
  test("keyed + local ready -> still uses fal, local is UNTOUCHED", async () => {
    const entry = makeEntry();
    const { host, writes } = makeHost([entry]);
    const { gateway, calls } = makeGateway({
      statuses: [{ status: "succeeded", resultJson: { text: "fal hi", chunks: [{ text: "fal hi", timestamp: [0, 1] }], inferred_languages: [] } }],
    });
    const extract: AudioExtractor = async () => ({ wav: new Uint8Array([1]), durationSeconds: 2 });
    const { local, transcribe } = await makeReadyLocal();
    const service = new TranscriptionService(gateway, host, extract, { ...NO_DELAY, local });

    const result = await service.transcribe("m1");

    expect(result.text).toBe("fal hi");
    expect(calls.submit).toBe(1);
    expect(calls.upload).toBe(1);
    expect(transcribe).not.toHaveBeenCalled();
    const record = JSON.parse(new TextDecoder().decode(writes[0]!.bytes));
    expect(record.provider).toBe("fal");
    expect(record.model).toBe("fal-ai/whisper");
  });

  test("keyless + local ready -> uses local.transcribe, fal is UNTOUCHED, writes provider:'local'", async () => {
    const entry = makeEntry();
    const { host, writes, store } = makeHost([entry]);
    const { gateway, calls } = makeGateway({ hasKey: async () => false });
    const extract: AudioExtractor = async () => ({ wav: SIXTEEN_KHZ_WAV, durationSeconds: 3 });
    const { local, transcribe } = await makeReadyLocal(async (pcm, sampleRate, language) => {
      expect(sampleRate).toBe(16000);
      expect(language).toBeUndefined();
      return { text: "local hi", words: [{ text: "local", start: 0, end: 0.5 }, { text: "hi", start: 0.5, end: 1 }] };
    });
    const service = new TranscriptionService(gateway, host, extract, { ...NO_DELAY, local });

    const result = await service.transcribe("m1");

    expect(result.text).toBe("local hi");
    expect(calls.submit).toBe(0);
    expect(calls.upload).toBe(0);
    expect(transcribe).toHaveBeenCalledTimes(1);
    const record = JSON.parse(new TextDecoder().decode(writes[0]!.bytes));
    expect(record.provider).toBe("local");
    expect(record.model).toBe("onnx-community/whisper-base");
    expect(store.get("m1")!.transcriptPath).toBe("media/m1.transcript.json");
  });

  test("keyless + no local configured -> the extended keyless error, no fal calls, no writes", async () => {
    const entry = makeEntry();
    const { host, writes, store } = makeHost([entry]);
    const { gateway, calls } = makeGateway({ hasKey: async () => false });
    const extract: AudioExtractor = async () => ({ wav: SIXTEEN_KHZ_WAV, durationSeconds: 3 });
    const service = new TranscriptionService(gateway, host, extract, NO_DELAY);

    await expect(service.transcribe("m1")).rejects.toThrow(/download the local transcription model/);

    expect(calls.submit).toBe(0);
    expect(calls.upload).toBe(0);
    expect(writes).toHaveLength(0);
    expect(store.get("m1")!.generationStatus).toMatch(/^failed: /);
  });

  test("keyless + local present but idle (not ready, not downloading) -> the extended keyless error", async () => {
    const entry = makeEntry();
    const { host, writes } = makeHost([entry]);
    const { gateway, calls } = makeGateway({ hasKey: async () => false });
    const extract: AudioExtractor = async () => ({ wav: SIXTEEN_KHZ_WAV, durationSeconds: 3 });
    const local = makeIdleLocal();
    const service = new TranscriptionService(gateway, host, extract, { ...NO_DELAY, local });

    await expect(service.transcribe("m1")).rejects.toThrow(/download the local transcription model/);
    expect(calls.submit).toBe(0);
    expect(writes).toHaveLength(0);
  });

  test("keyless + local failed -> the extended keyless error (no implicit retry)", async () => {
    const entry = makeEntry();
    const { host } = makeHost([entry]);
    const { gateway } = makeGateway({ hasKey: async () => false });
    const extract: AudioExtractor = async () => ({ wav: SIXTEEN_KHZ_WAV, durationSeconds: 3 });
    const local = await makeFailedLocal();
    const service = new TranscriptionService(gateway, host, extract, { ...NO_DELAY, local });

    await expect(service.transcribe("m1")).rejects.toThrow(/download the local transcription model/);
  });

  // F2: run() awaits gateway.hasKey() directly now (pre-M14A never called it). Per the M10 rule, a
  // rejecting hasKey means "no key" (not a hard failure) — .catch(() => false) at the await site.
  test("F2: hasKey() rejects + local ready -> falls through to local, not a thrown rejection", async () => {
    const entry = makeEntry();
    const { host, writes } = makeHost([entry]);
    const { gateway, calls } = makeGateway({ hasKey: async () => { throw new Error("network down"); } });
    const extract: AudioExtractor = async () => ({ wav: SIXTEEN_KHZ_WAV, durationSeconds: 3 });
    const { local, transcribe } = await makeReadyLocal();
    const service = new TranscriptionService(gateway, host, extract, { ...NO_DELAY, local });

    const result = await service.transcribe("m1");

    expect(result.text).toBe("local hi");
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(calls.submit).toBe(0);
    const record = JSON.parse(new TextDecoder().decode(writes[0]!.bytes));
    expect(record.provider).toBe("local");
  });

  test("F2: hasKey() rejects + no local ready -> the keyless error, not the raw rejection", async () => {
    const entry = makeEntry();
    const { host } = makeHost([entry]);
    const { gateway, calls } = makeGateway({ hasKey: async () => { throw new Error("network down"); } });
    const extract: AudioExtractor = async () => ({ wav: SIXTEEN_KHZ_WAV, durationSeconds: 3 });
    const local = makeIdleLocal();
    const service = new TranscriptionService(gateway, host, extract, { ...NO_DELAY, local });

    await expect(service.transcribe("m1")).rejects.toThrow(/download the local transcription model/);
    expect(calls.submit).toBe(0);
  });

  test("forceLocal ignores the key: never calls gateway.hasKey/upload/submit, even though keyed", async () => {
    const entry = makeEntry();
    const { host, writes } = makeHost([entry]);
    const hasKey = vi.fn(async () => true);
    const { gateway, calls } = makeGateway({ hasKey });
    const extract: AudioExtractor = async () => ({ wav: SIXTEEN_KHZ_WAV, durationSeconds: 3 });
    const { local, transcribe } = await makeReadyLocal();
    const service = new TranscriptionService(gateway, host, extract, { ...NO_DELAY, local });

    const result = await service.transcribe("m1", { forceLocal: true });

    expect(result.text).toBe("local hi");
    expect(hasKey).not.toHaveBeenCalled();
    expect(calls.submit).toBe(0);
    expect(calls.upload).toBe(0);
    expect(transcribe).toHaveBeenCalledTimes(1);
    const record = JSON.parse(new TextDecoder().decode(writes[0]!.bytes));
    expect(record.provider).toBe("local");
  });

  test("forceLocal + local not ready -> the extended error, still never touches fal", async () => {
    const entry = makeEntry();
    const { host } = makeHost([entry]);
    const hasKey = vi.fn(async () => true);
    const { gateway, calls } = makeGateway({ hasKey });
    const extract: AudioExtractor = async () => ({ wav: SIXTEEN_KHZ_WAV, durationSeconds: 3 });
    const local = makeIdleLocal();
    const service = new TranscriptionService(gateway, host, extract, { ...NO_DELAY, local });

    await expect(service.transcribe("m1", { forceLocal: true })).rejects.toThrow(/download the local transcription model/);
    expect(hasKey).not.toHaveBeenCalled();
    expect(calls.submit).toBe(0);
  });

  test("dedupe key is unchanged by forceLocal: concurrent forceLocal/non-forceLocal calls for the same (ref, language) share one run", async () => {
    const entry = makeEntry();
    const { host } = makeHost([entry]);
    const { gateway, calls } = makeGateway({ hasKey: async () => false });
    const extract: AudioExtractor = async () => ({ wav: SIXTEEN_KHZ_WAV, durationSeconds: 3 });
    const { local, transcribe } = await makeReadyLocal();
    const service = new TranscriptionService(gateway, host, extract, { ...NO_DELAY, local });

    const [a, b] = await Promise.all([service.transcribe("m1"), service.transcribe("m1", { forceLocal: true })]);

    expect(a).toEqual(b);
    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(calls.submit).toBe(0);
  });

  // F1: pins the OTHER dedupe-join interleaving — a keyed fal run already in flight, joined by a
  // forceLocal (background) call for the same (ref, language). forceLocal isn't part of the dedupe
  // key, so the joiner never runs its own provider decision; it just awaits the first caller's
  // promise. No second gateway invocation is caused by the join, and the cache is tagged by the
  // FIRST caller's provider (fal here) — never silently downgraded by the background joiner.
  test("in-flight KEYED fal run joined by a forceLocal call: one gateway invocation total, both get the fal result, cache tagged fal", async () => {
    const entry = makeEntry();
    const { host, writes } = makeHost([entry]);
    const { gateway, calls } = makeGateway({
      hasKey: async () => true,
      statuses: [{ status: "succeeded", resultJson: { text: "fal hi", chunks: [{ text: "fal hi", timestamp: [0, 1] }], inferred_languages: [] } }],
    });
    const extract: AudioExtractor = async () => ({ wav: SIXTEEN_KHZ_WAV, durationSeconds: 3 });
    const { local, transcribe } = await makeReadyLocal();
    const service = new TranscriptionService(gateway, host, extract, { ...NO_DELAY, local });

    const [a, b] = await Promise.all([service.transcribe("m1"), service.transcribe("m1", { forceLocal: true })]);

    expect(a.text).toBe("fal hi");
    expect(b).toEqual(a);
    expect(calls.submit).toBe(1);
    expect(calls.upload).toBe(1);
    expect(transcribe).not.toHaveBeenCalled();
    const record = JSON.parse(new TextDecoder().decode(writes[0]!.bytes));
    expect(record.provider).toBe("fal");
  });
});

describe("TranscriptionService.transcribe: cache-first", () => {
  test("cache hit: transcriptPath set + a valid cache record -> returns the full result, no gateway/extract calls at all", async () => {
    const record: TranscriptRecord = {
      text: "hello world",
      language: "en",
      words: [{ text: "hello", start: 0, end: 0.5 }, { text: "world", start: 0.5, end: 1 }],
      segments: [{ text: "hello world", start: 0, end: 1 }],
      sourceDurationSeconds: 10,
      model: "fal-ai/whisper",
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
      statuses: [{ status: "succeeded", resultJson: { text: "fresh", chunks: [{ text: "fresh", timestamp: [0, 1] }], inferred_languages: [] } }],
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
    const resultJson = { text: "hi there", chunks: [{ text: "hi there", timestamp: [0, 1] }], inferred_languages: ["en"] };
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
      model: "fal-ai/whisper",
      provider: "fal",
    });

    const final = store.get("m1")!;
    expect(final.transcriptPath).toBe("media/m1.transcript.json");
    expect(final.generationStatus).toBeUndefined();
  });

  test("uploads the extracted WAV as audio/wav and submits fal-ai/whisper with the fal-fetchable URL", async () => {
    const entry = makeEntry();
    const { host } = makeHost([entry]);
    const uploadCalls: { bytes: Uint8Array; contentType: string; fileName: string }[] = [];
    const submittedInputs: Record<string, unknown>[] = [];
    const { gateway } = makeGateway({
      uploadFile: async (bytes, contentType, fileName) => {
        uploadCalls.push({ bytes, contentType, fileName });
        return "https://v3.fal.media/files/m1.wav";
      },
      statuses: [{ status: "succeeded", resultJson: { text: "hi", chunks: [{ text: "hi", timestamp: [0, 1] }], inferred_languages: [] } }],
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
    const staleRecord: TranscriptRecord = { text: "stale", words: [], segments: [], sourceDurationSeconds: 1, model: "fal-ai/whisper" };
    const entry = makeEntry({ transcriptPath: path });
    const { host, writes, readDerivedCalls, store } = makeHost([entry], { [path]: new TextEncoder().encode(JSON.stringify(staleRecord)) });
    const resultJson = { text: "french hi", chunks: [{ text: "french hi", timestamp: [0, 1] }], inferred_languages: ["fr"] };
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
      statuses: [{ status: "succeeded", resultJson: { text: "hi", chunks: [{ text: "hi", timestamp: [0, 1] }], inferred_languages: [] } }],
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
    const { gateway } = makeGateway({ statuses: [{ status: "failed", errorMessage: "whisper exploded" }] });
    const extract: AudioExtractor = async () => ({ wav: new Uint8Array([1]), durationSeconds: 2 });
    const service = new TranscriptionService(gateway, host, extract, NO_DELAY);

    await expect(service.transcribe("m1")).rejects.toThrow("whisper exploded");
    expect(store.get("m1")!.generationStatus).toBe("failed: whisper exploded");
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
        if (ref === "c") return { status: "failed", errorMessage: "whisper exploded" };
        return { status: "succeeded", resultJson: { text: `hi ${ref}`, chunks: [{ text: `hi ${ref}`, timestamp: [0, 1] }], inferred_languages: [] } };
      },
    });
    const service = new TranscriptionService(gateway, host, extract, NO_DELAY);

    const results = await service.transcribeMany(["a", "b", "a", "c"]);

    expect(calls.submit).toBe(3); // a, b, c — the duplicate "a" collapses
    expect(results).toHaveLength(3);
    const byRef = new Map(results.map((r) => [r.ref, r]));
    expect(byRef.get("a")?.result?.text).toBe("hi a");
    expect(byRef.get("b")?.result?.text).toBe("hi b");
    expect(byRef.get("c")?.error).toBe("whisper exploded");
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

function flushMacrotask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("TranscriptionService: audio extraction concurrency", () => {
  test("caps concurrent extractions at 2 across many uncached refs; never exceeds the high-water mark", async () => {
    const refs = ["a", "b", "c", "d", "e"];
    const { host } = makeHost(refs.map((id) => makeEntry({ id })));
    const { gateway } = makeGateway({
      submitJobId: (input) => "job:" + (input as { audio_url: string }).audio_url,
      statusFor: (jobId) => ({ status: "succeeded", resultJson: { text: jobId, chunks: [{ text: jobId, timestamp: [0, 1] }], inferred_languages: [] } }),
    });

    let inFlight = 0;
    let highWater = 0;
    const releases: Array<() => void> = [];
    const extract: AudioExtractor = async (ref) => {
      inFlight++;
      highWater = Math.max(highWater, inFlight);
      await new Promise<void>((resolve) => releases.push(resolve));
      inFlight--;
      return { wav: new TextEncoder().encode(ref), durationSeconds: 1 };
    };
    const service = new TranscriptionService(gateway, host, extract, NO_DELAY);

    const done = service.transcribeMany(refs);
    await flushMacrotask();

    expect(inFlight).toBe(2);
    expect(highWater).toBe(2);

    // Release the first wave; the next batch should fill back in to the same cap, never above it.
    releases.splice(0).forEach((resolve) => resolve());
    await flushMacrotask();
    expect(inFlight).toBe(2);
    expect(highWater).toBe(2);

    releases.splice(0).forEach((resolve) => resolve());
    await flushMacrotask();
    releases.splice(0).forEach((resolve) => resolve());

    await done;
    expect(highWater).toBe(2);
  });

  test("cache hits never touch the extraction gate — they don't queue behind in-flight extractions", async () => {
    const cachedPath = "media/cached.transcript.json";
    const record: TranscriptRecord = {
      text: "cached",
      language: "en",
      words: [],
      segments: [],
      sourceDurationSeconds: 1,
      model: "fal-ai/whisper",
    };
    const entries = [
      makeEntry({ id: "a" }),
      makeEntry({ id: "b" }),
      makeEntry({ id: "cached", transcriptPath: cachedPath }),
    ];
    const { host } = makeHost(entries, { [cachedPath]: new TextEncoder().encode(JSON.stringify(record)) });
    const { gateway } = makeGateway({});

    let inFlight = 0;
    const releases: Array<() => void> = [];
    const extract: AudioExtractor = async () => {
      inFlight++;
      await new Promise<void>((resolve) => releases.push(resolve));
      inFlight--;
      return { wav: new Uint8Array(), durationSeconds: 1 };
    };
    const service = new TranscriptionService(gateway, host, extract, NO_DELAY);

    // Saturate the gate with two uncached extractions, then confirm the cached ref still resolves.
    void service.transcribe("a");
    void service.transcribe("b");
    await flushMacrotask();
    expect(inFlight).toBe(2);

    const result = await service.transcribe("cached");
    expect(result.text).toBe("cached");

    releases.splice(0).forEach((resolve) => resolve());
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
      statuses: [{ status: "succeeded", resultJson: { text: "hi", chunks: [{ text: "hi", timestamp: [0, 1] }], inferred_languages: [] } }],
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
      statusFor: () => ({ status: "succeeded", resultJson: { text: "hi", chunks: [{ text: "hi", timestamp: [0, 1] }], inferred_languages: [] } }),
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
      statusFor: () => ({ status: "succeeded", resultJson: { text: "hi", chunks: [{ text: "hi", timestamp: [0, 1] }], inferred_languages: [] } }),
    });
    const service = new TranscriptionService(gateway, host, extract, NO_DELAY);

    await service.transcribe("m1", { language: "fr" });
    await service.transcribe("m1", { language: "fr" });

    expect(calls.submit).toBe(2);
  });
});

describe("TranscriptionService.cachedTranscript", () => {
  test("returns the cached full result without touching the gateway or extractor", async () => {
    const record: TranscriptRecord = { text: "hi", language: "en", words: [], segments: [], sourceDurationSeconds: 1, model: "fal-ai/whisper" };
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
  test("estimateCredits delegates to the whisper catalog entry's audioPerSecond pricing", () => {
    const { host } = makeHost([]);
    const { gateway } = makeGateway({});
    const service = new TranscriptionService(gateway, host, async () => ({ wav: new Uint8Array(), durationSeconds: 0 }));
    // 0.111 credits/s * 250s = 27.75 -> ceil 28.
    expect(service.estimateCredits(250)).toBe(28);
  });

  test("hasKey passes through to the gateway", async () => {
    const { host } = makeHost([]);
    const { gateway } = makeGateway({ hasKey: async () => false });
    const service = new TranscriptionService(gateway, host, async () => ({ wav: new Uint8Array(), durationSeconds: 0 }));
    expect(await service.hasKey()).toBe(false);
  });
});
