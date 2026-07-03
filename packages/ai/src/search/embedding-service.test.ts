import { describe, expect, test, vi } from "vitest";
import type { EmbeddingModelInfo, EmbeddingPipelines, EmbeddingProgress } from "./embedding-service.js";
import { EmbeddingService } from "./embedding-service.js";

const INFO: EmbeddingModelInfo = { model: "siglip2-base-patch16-256", modelVersion: "test-checkpoint", dim: 4 };

function unitVector(n: number, dim = 4): Float32Array {
  const v = new Float32Array(dim);
  v[n % dim] = 1;
  return v;
}

function makeStubPipelines(overrides: Partial<EmbeddingPipelines> = {}): EmbeddingPipelines {
  return {
    embedImage: vi.fn(async () => unitVector(0)),
    embedText: vi.fn(async () => unitVector(1)),
    ...overrides,
  };
}

/** Deferred loader: resolves/rejects on demand, records every call + the onProgress it was given. */
function makeDeferredLoader(pipelines: EmbeddingPipelines) {
  const calls: Array<(p: EmbeddingProgress) => void | undefined> = [];
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const gate = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const loadPipelines = vi.fn((onProgress?: (p: EmbeddingProgress) => void) => {
    calls.push(onProgress as (p: EmbeddingProgress) => void);
    return gate.then(() => pipelines);
  });
  return { loadPipelines, calls, resolve, reject };
}

describe("EmbeddingService", () => {
  test("idle before first ensureReady", () => {
    const svc = new EmbeddingService({ loadPipelines: async () => makeStubPipelines(), info: INFO });
    expect(svc.state).toBe("idle");
  });

  test("transitions idle -> downloading -> ready", async () => {
    const pipelines = makeStubPipelines();
    const { loadPipelines, resolve } = makeDeferredLoader(pipelines);
    const svc = new EmbeddingService({ loadPipelines, info: INFO });

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
    const svc = new EmbeddingService({ loadPipelines, info: INFO });

    await expect(svc.ensureReady()).rejects.toThrow("network down");
    expect(svc.state).toBe("failed");

    await svc.ensureReady();
    expect(svc.state).toBe("ready");
    expect(loadPipelines).toHaveBeenCalledTimes(2);
  });

  test("ensureReady is idempotent once ready — no reload", async () => {
    const loadPipelines = vi.fn(async () => makeStubPipelines());
    const svc = new EmbeddingService({ loadPipelines, info: INFO });

    await svc.ensureReady();
    await svc.ensureReady();
    await svc.ensureReady();
    expect(loadPipelines).toHaveBeenCalledTimes(1);
  });

  test("two concurrent ensureReady calls single-flight into one load, progress forwarded to both", async () => {
    const pipelines = makeStubPipelines();
    const { loadPipelines, calls, resolve } = makeDeferredLoader(pipelines);
    const svc = new EmbeddingService({ loadPipelines, info: INFO });

    const p1Events: EmbeddingProgress[] = [];
    const p2Events: EmbeddingProgress[] = [];
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

  test("embedImage delegates and normalizes to unit length", async () => {
    const embedImage = vi.fn(async () => new Float32Array([3, 4, 0, 0])); // magnitude 5
    const svc = new EmbeddingService({ loadPipelines: async () => makeStubPipelines({ embedImage }), info: INFO });
    await svc.ensureReady();

    const rgba = new Uint8ClampedArray(256 * 256 * 4);
    const vector = await svc.embedImage(rgba, 256, 256);

    expect(embedImage).toHaveBeenCalledWith(rgba, 256, 256);
    expect(vector).toEqual(new Float32Array([0.6, 0.8, 0, 0]));
    const norm = Math.hypot(...vector);
    expect(norm).toBeCloseTo(1, 6);
  });

  test("embedText delegates and normalizes to unit length", async () => {
    const embedText = vi.fn(async () => new Float32Array([0, 0, 6, 8])); // magnitude 10
    const svc = new EmbeddingService({ loadPipelines: async () => makeStubPipelines({ embedText }), info: INFO });
    await svc.ensureReady();

    const vector = await svc.embedText("a red barn");

    expect(embedText).toHaveBeenCalledWith("a red barn");
    expect(vector).toEqual(new Float32Array([0, 0, 0.6, 0.8]));
  });

  test("embedImage throws before delegating if the pipeline is not ready", async () => {
    const svc = new EmbeddingService({ loadPipelines: async () => makeStubPipelines(), info: INFO });
    const rgba = new Uint8ClampedArray(256 * 256 * 4);
    await expect(svc.embedImage(rgba, 256, 256)).rejects.toThrow();
  });

  test("embedImage rejects non-256x256 input without calling the pipeline", async () => {
    const embedImage = vi.fn(async () => unitVector(0));
    const svc = new EmbeddingService({ loadPipelines: async () => makeStubPipelines({ embedImage }), info: INFO });
    await svc.ensureReady();

    const rgba = new Uint8ClampedArray(128 * 128 * 4);
    await expect(svc.embedImage(rgba, 128, 128)).rejects.toThrow(/256/);
    expect(embedImage).not.toHaveBeenCalled();
  });

  test("wrong-dim pipeline output on embedImage raises a clear error", async () => {
    const embedImage = vi.fn(async () => new Float32Array([1, 0, 0])); // dim 3, service expects 4
    const svc = new EmbeddingService({ loadPipelines: async () => makeStubPipelines({ embedImage }), info: INFO });
    await svc.ensureReady();

    const rgba = new Uint8ClampedArray(256 * 256 * 4);
    await expect(svc.embedImage(rgba, 256, 256)).rejects.toThrow(/dim/i);
  });

  test("wrong-dim pipeline output on embedText raises a clear error", async () => {
    const embedText = vi.fn(async () => new Float32Array(768)); // way off from the test INFO.dim of 4
    const svc = new EmbeddingService({ loadPipelines: async () => makeStubPipelines({ embedText }), info: INFO });
    await svc.ensureReady();

    await expect(svc.embedText("hello")).rejects.toThrow(/dim/i);
  });

  test("info is exposed verbatim from deps", () => {
    const svc = new EmbeddingService({ loadPipelines: async () => makeStubPipelines(), info: INFO });
    expect(svc.info).toEqual(INFO);
  });
});
