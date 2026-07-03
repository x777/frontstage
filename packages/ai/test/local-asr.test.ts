import { describe, expect, test, vi } from "vitest";
import type { LocalAsrInfo, LocalAsrPipelines, LocalAsrProgress, RawLocalTranscript } from "../src/transcription/local-asr.js";
import { LocalAsrService } from "../src/transcription/local-asr.js";

const INFO: LocalAsrInfo = { model: "whisper-base", modelVersion: "test-checkpoint" };

function makeStubPipelines(overrides: Partial<LocalAsrPipelines> = {}): LocalAsrPipelines {
  return {
    transcribe: vi.fn(async (): Promise<RawLocalTranscript> => ({ text: "hi", words: [{ text: "hi", start: 0, end: 0.5 }] })),
    ...overrides,
  };
}

/** Deferred loader: resolves/rejects on demand, records every call + the onProgress it was given. */
function makeDeferredLoader(pipelines: LocalAsrPipelines) {
  const calls: Array<(p: LocalAsrProgress) => void | undefined> = [];
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const gate = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const loadPipelines = vi.fn((onProgress?: (p: LocalAsrProgress) => void) => {
    calls.push(onProgress as (p: LocalAsrProgress) => void);
    return gate.then(() => pipelines);
  });
  return { loadPipelines, calls, resolve, reject };
}

describe("LocalAsrService: state machine", () => {
  test("idle before first ensureReady", () => {
    const svc = new LocalAsrService({ loadPipelines: async () => makeStubPipelines(), info: INFO });
    expect(svc.state).toBe("idle");
  });

  test("transitions idle -> downloading -> ready", async () => {
    const pipelines = makeStubPipelines();
    const { loadPipelines, resolve } = makeDeferredLoader(pipelines);
    const svc = new LocalAsrService({ loadPipelines, info: INFO });

    const ready = svc.ensureReady();
    expect(svc.state).toBe("downloading");
    resolve();
    await ready;
    expect(svc.state).toBe("ready");
  });

  test("load rejection sets failed, and a subsequent call retries to ready", async () => {
    const pipelines = makeStubPipelines();
    let attempt = 0;
    const loadPipelines = vi.fn(async () => {
      attempt++;
      if (attempt === 1) throw new Error("network down");
      return pipelines;
    });
    const svc = new LocalAsrService({ loadPipelines, info: INFO });

    await expect(svc.ensureReady()).rejects.toThrow("network down");
    expect(svc.state).toBe("failed");

    await svc.ensureReady();
    expect(svc.state).toBe("ready");
    expect(loadPipelines).toHaveBeenCalledTimes(2);
  });

  test("ensureReady is idempotent once ready -- no reload", async () => {
    const loadPipelines = vi.fn(async () => makeStubPipelines());
    const svc = new LocalAsrService({ loadPipelines, info: INFO });

    await svc.ensureReady();
    await svc.ensureReady();
    await svc.ensureReady();
    expect(loadPipelines).toHaveBeenCalledTimes(1);
  });

  test("two concurrent ensureReady calls single-flight into one load, progress forwarded to both", async () => {
    const pipelines = makeStubPipelines();
    const { loadPipelines, calls, resolve } = makeDeferredLoader(pipelines);
    const svc = new LocalAsrService({ loadPipelines, info: INFO });

    const p1Events: LocalAsrProgress[] = [];
    const p2Events: LocalAsrProgress[] = [];
    const first = svc.ensureReady((p) => p1Events.push(p));
    const second = svc.ensureReady((p) => p2Events.push(p));

    expect(loadPipelines).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
    calls[0]!({ loaded: 50, total: 100 });
    resolve();
    await Promise.all([first, second]);

    expect(p1Events).toEqual([{ loaded: 50, total: 100 }]);
    expect(p2Events).toEqual([{ loaded: 50, total: 100 }]);
  });

  test("info is exposed verbatim from deps", () => {
    const svc = new LocalAsrService({ loadPipelines: async () => makeStubPipelines(), info: INFO });
    expect(svc.info).toEqual(INFO);
  });
});

describe("LocalAsrService.transcribe: raw -> TranscriptionResult mapping", () => {
  test("throws before delegating if the pipeline is not ready", async () => {
    const svc = new LocalAsrService({ loadPipelines: async () => makeStubPipelines(), info: INFO });
    await expect(svc.transcribe(new Float32Array(4))).rejects.toThrow(/ensureReady/);
  });

  test("passes pcm, the fixed 16000 sample rate, and language through to the pipeline", async () => {
    const transcribe = vi.fn(async (): Promise<RawLocalTranscript> => ({ text: "hi", words: [] }));
    const svc = new LocalAsrService({ loadPipelines: async () => makeStubPipelines({ transcribe }), info: INFO });
    await svc.ensureReady();

    const pcm = new Float32Array([0.1, 0.2, 0.3]);
    await svc.transcribe(pcm, "fr");

    expect(transcribe).toHaveBeenCalledWith(pcm, 16000, "fr");
  });

  test("maps raw words into TranscriptionWord[] and derives segments when the raw output lacks them", async () => {
    const raw: RawLocalTranscript = {
      text: "Hi there. Wow!",
      language: "en",
      words: [
        { text: "Hi", start: 0, end: 0.4 },
        { text: "there.", start: 0.4, end: 0.9 },
        { text: "Wow!", start: 0.9, end: 1.3 },
      ],
    };
    const svc = new LocalAsrService({ loadPipelines: async () => makeStubPipelines({ transcribe: async () => raw }), info: INFO });
    await svc.ensureReady();

    const result = await svc.transcribe(new Float32Array(4));

    expect(result.text).toBe("Hi there. Wow!");
    expect(result.language).toBe("en");
    expect(result.words).toEqual(raw.words);
    // deriveSegments splits on sentence-ending punctuation (whisper-wire's rule, reused here).
    expect(result.segments).toEqual([
      { text: "Hi there.", start: 0, end: 0.9 },
      { text: "Wow!", start: 0.9, end: 1.3 },
    ]);
  });

  test("uses the raw output's segments verbatim when present, without deriving", async () => {
    const raw: RawLocalTranscript = {
      text: "custom segmenting",
      words: [{ text: "custom", start: 0, end: 0.5 }, { text: "segmenting", start: 0.5, end: 1 }],
      segments: [{ text: "custom segmenting", start: 0, end: 1 }],
    };
    const svc = new LocalAsrService({ loadPipelines: async () => makeStubPipelines({ transcribe: async () => raw }), info: INFO });
    await svc.ensureReady();

    const result = await svc.transcribe(new Float32Array(4));

    expect(result.segments).toEqual(raw.segments);
  });

  test("a word with no timestamps maps through with start/end undefined", async () => {
    const raw: RawLocalTranscript = { text: "um", words: [{ text: "um" }] };
    const svc = new LocalAsrService({ loadPipelines: async () => makeStubPipelines({ transcribe: async () => raw }), info: INFO });
    await svc.ensureReady();

    const result = await svc.transcribe(new Float32Array(4));

    expect(result.words).toEqual([{ text: "um", start: undefined, end: undefined }]);
    expect(result.segments).toEqual([]); // no timestamped words -> deriveSegments drops it
  });
});
