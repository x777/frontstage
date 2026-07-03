import { describe, expect, test, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import type { MediaManifestEntry } from "@palmier/core";
import { candidateTimes, decodeEmbeddings, embeddingRelativePath, encodeEmbeddings } from "@palmier/core";
import type { EmbeddingHeader } from "@palmier/core";
import { MediaIndexingService, IndexingStatusRelay } from "../src/media/media-indexing.js";
import type { FrameTap, MediaIndexingDeps, MediaIndexingEmbedding, MediaIndexingHost } from "../src/media/media-indexing.js";

const INFO = { model: "siglip2-base-patch16-256", modelVersion: "test-checkpoint", dim: 2 };
const SAMPLER_VERSION = "test-v1";
// A real (if zero-delay) macrotask yield — NOT an immediately-resolved microtask promise. The
// readiness watcher loops until an external mutation (the test flipping embedding.state) happens,
// which can only run once control returns to the test's own continuation; a pure-microtask sleep
// here would starve macrotask timers (incl. testing-library's waitFor polling) forever.
const FAST = { readyPollMs: 0, sleep: (_ms: number) => new Promise<void>((resolve) => setTimeout(resolve, 0)) };

function solidRGBA(gray: number): Uint8ClampedArray {
  // r=g=b -> Rec.601 luma == gray exactly, so gridDiff between two solid frames == |grayA - grayB|.
  const buf = new Uint8ClampedArray(TAP * TAP * 4);
  for (let i = 0; i < TAP * TAP; i++) {
    buf[i * 4] = gray;
    buf[i * 4 + 1] = gray;
    buf[i * 4 + 2] = gray;
    buf[i * 4 + 3] = 255;
  }
  return buf;
}
const TAP = 256;

function videoEntry(id: string, overrides: Partial<MediaManifestEntry> = {}): MediaManifestEntry {
  return {
    id,
    name: `${id}.mp4`,
    type: "video",
    source: { kind: "project", relativePath: `media/${id}.mp4` },
    duration: 9,
    sourceWidth: 100,
    sourceHeight: 100,
    ...overrides,
  };
}

function imageEntry(id: string, overrides: Partial<MediaManifestEntry> = {}): MediaManifestEntry {
  return {
    id,
    name: `${id}.png`,
    type: "image",
    source: { kind: "project", relativePath: `media/${id}.png` },
    duration: 5,
    ...overrides,
  };
}

function makeHost(seed: MediaManifestEntry[] = []) {
  const store = new Map(seed.map((e) => [e.id, e]));
  const derived = new Map<string, Uint8Array>();
  const writes: { path: string; bytes: Uint8Array }[] = [];
  const patches: { id: string; patch: Partial<MediaManifestEntry> }[] = [];
  const events: string[] = []; // write/patch interleaving, in call order — proves write precedes patch
  const host: MediaIndexingHost = {
    entries: () => [...store.values()],
    patchEntry: (id, patch) => {
      patches.push({ id, patch });
      events.push(`patch:${id}`);
      const existing = store.get(id);
      if (existing) store.set(id, { ...existing, ...patch });
    },
    writeDerived: (path, bytes) => {
      writes.push({ path, bytes });
      events.push(`write:${path}`);
      derived.set(path, bytes);
    },
    readDerived: async (path) => derived.get(path) ?? null,
  };
  return { host, store, derived, writes, patches, events };
}

function seedEmbed(derived: Map<string, Uint8Array>, entry: MediaManifestEntry, header: Partial<EmbeddingHeader> = {}) {
  const full: EmbeddingHeader = { model: INFO.model, modelVersion: INFO.modelVersion, samplerVersion: SAMPLER_VERSION, dim: INFO.dim, count: 0, sourceBytes: 1000, ...header };
  const bytes = encodeEmbeddings(full, []);
  const path = embeddingRelativePath(entry.id);
  derived.set(path, bytes);
  entry.embeddingPath = path;
}

function makeEmbedding(overrides: Partial<MediaIndexingEmbedding> = {}): MediaIndexingEmbedding & { embedCalls: { rgba: Uint8ClampedArray; width: number; height: number }[] } {
  const embedCalls: { rgba: Uint8ClampedArray; width: number; height: number }[] = [];
  return {
    state: "ready",
    info: INFO,
    embedImage: async (rgba, width, height) => {
      embedCalls.push({ rgba, width, height });
      return Float32Array.from([embedCalls.length, 0]);
    },
    embedCalls,
    ...overrides,
  };
}

function makeOpenMedia(byteLength = 1000) {
  const calls: string[] = [];
  const releases: string[] = [];
  const openMedia = vi.fn(async (entry: MediaManifestEntry) => {
    calls.push(entry.id);
    return { url: `blob:${entry.id}`, byteLength, release: () => releases.push(entry.id) };
  });
  return { openMedia, calls, releases };
}

/** Per-entry gray value at each requested time (rec601 luma == gray for solid frames). */
function makeTapFromGrays(grays: Record<string, Record<number, number>>): { tap: FrameTap; tapCalls: { id: string; times: number[] }[] } {
  const tapCalls: { id: string; times: number[] }[] = [];
  const tap: FrameTap = async function* (entry, _blobUrl, times) {
    tapCalls.push({ id: entry.id, times: [...times] });
    for (const t of times) {
      const gray = grays[entry.id]?.[t] ?? 0;
      yield { timeSec: t, rgba: solidRGBA(gray), width: 256, height: 256 };
    }
  };
  return { tap, tapCalls };
}

function makeService(overrides: Partial<MediaIndexingDeps> & { library: MediaIndexingHost }) {
  const embedding = overrides.embedding ?? makeEmbedding();
  const { openMedia } = makeOpenMedia();
  const { tap } = makeTapFromGrays({});
  return new MediaIndexingService({
    embedding,
    sampleFrames: tap,
    samplerVersion: SAMPLER_VERSION,
    openMedia,
    ...FAST,
    ...overrides,
  });
}

describe("MediaIndexingService: queue selection", () => {
  test("an entry with no embeddingPath is queued and indexed", async () => {
    const entry = videoEntry("a", { duration: 1, sourceWidth: 10, sourceHeight: 10 });
    const { host, patches } = makeHost([entry]);
    const { tap } = makeTapFromGrays({ a: { 0.5: 100 } });
    const { openMedia } = makeOpenMedia();
    const svc = new MediaIndexingService({ library: host, embedding: makeEmbedding(), sampleFrames: tap, samplerVersion: SAMPLER_VERSION, openMedia, ...FAST });

    svc.start();

    await waitFor(() => expect(svc.status).toEqual({ kind: "idle" }));
    expect(patches.some((p) => p.id === "a" && p.patch.embeddingPath)).toBe(true);
  });

  test("an entry with a valid current .embed is skipped (no open, no write)", async () => {
    const entry = videoEntry("a");
    const { host, derived, writes } = makeHost([entry]);
    seedEmbed(derived, entry);
    const { openMedia, calls } = makeOpenMedia(1000);
    const svc = makeService({ library: host, openMedia });

    svc.start();
    await waitFor(() => expect(svc.status).toEqual({ kind: "idle" }));

    // needsIndex still opens once to compare sourceBytes, but never re-indexes (no write).
    expect(calls).toEqual(["a"]);
    expect(writes).toHaveLength(0);
  });

  test("a header model/modelVersion/samplerVersion mismatch re-indexes, opening media only once (for the actual reindex, not the staleness check)", async () => {
    const entry = videoEntry("a", { duration: 1, sourceWidth: 10, sourceHeight: 10 });
    const { host, derived, writes } = makeHost([entry]);
    seedEmbed(derived, entry, { samplerVersion: "stale-version" });
    const { tap } = makeTapFromGrays({ a: { 0.5: 100 } });
    const { openMedia, calls } = makeOpenMedia();
    const svc = new MediaIndexingService({ library: host, embedding: makeEmbedding(), sampleFrames: tap, samplerVersion: SAMPLER_VERSION, openMedia, ...FAST });

    svc.start();
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(calls).toEqual(["a"]);
  });

  test("a sourceBytes mismatch (file replaced at the same path) re-indexes", async () => {
    const entry = videoEntry("a", { duration: 1, sourceWidth: 10, sourceHeight: 10 });
    const { host, derived, writes } = makeHost([entry]);
    seedEmbed(derived, entry, { sourceBytes: 999 });
    const { tap } = makeTapFromGrays({ a: { 0.5: 100 } });
    const { openMedia } = makeOpenMedia(1000); // current bytes differ from the cached header's 999
    const svc = new MediaIndexingService({ library: host, embedding: makeEmbedding(), sampleFrames: tap, samplerVersion: SAMPLER_VERSION, openMedia, ...FAST });

    svc.start();
    await waitFor(() => expect(writes).toHaveLength(1));
    const decoded = decodeEmbeddings(writes[0]!.bytes)!;
    expect(decoded.header.sourceBytes).toBe(1000);
  });

  test("non-video/image entries (e.g. audio) are never queued", async () => {
    const entry: MediaManifestEntry = { id: "a", name: "a.wav", type: "audio", source: { kind: "project", relativePath: "media/a.wav" }, duration: 5 };
    const { host, writes } = makeHost([entry]);
    const svc = makeService({ library: host });

    svc.start();
    await waitFor(() => expect(svc.status).toEqual({ kind: "idle" }));
    expect(writes).toHaveLength(0);
  });
});

describe("MediaIndexingService: per-entry pipeline (sample -> detect -> embed -> encode -> write -> patch)", () => {
  test("scene-detected shots: only kept samples are embedded, trailing shotEnd patched to duration", async () => {
    const entry = videoEntry("a", { duration: 9, sourceWidth: 100, sourceHeight: 100 });
    expect(candidateTimes({ durationSec: 9, longEdgePx: 100 })).toEqual([1, 3, 5, 7]);

    const { host, writes, events } = makeHost([entry]);
    // t=1,3 same shot (gray 100, diff 0 < 12); t=5 scene change (diff 100 >= 12); t=7 same shot as t=5.
    // t=3 and t=7 fall inside the 8s coverage floor of their shot's last kept frame, so only 1 and 5 are kept.
    const { tap, tapCalls } = makeTapFromGrays({ a: { 1: 100, 3: 100, 5: 200, 7: 200 } });
    const embedding = makeEmbedding();
    const { openMedia } = makeOpenMedia();
    const svc = new MediaIndexingService({ library: host, embedding, sampleFrames: tap, samplerVersion: SAMPLER_VERSION, openMedia, ...FAST });

    svc.start();
    await waitFor(() => expect(writes).toHaveLength(1));

    // Tapped every candidate (needed for scene diffing) but only embedded the 2 kept samples.
    expect(tapCalls).toEqual([{ id: "a", times: [1, 3, 5, 7] }]);
    expect(embedding.embedCalls).toHaveLength(2);

    const decoded = decodeEmbeddings(writes[0]!.bytes)!;
    expect(decoded.rows).toEqual([
      { time: 1, shotStart: 0, shotEnd: 5, vector: expect.any(Float32Array) },
      { time: 5, shotStart: 5, shotEnd: 9, vector: expect.any(Float32Array) }, // patched: was shotEnd===shotStart===5
    ]);
    expect(decoded.header).toMatchObject({ model: INFO.model, modelVersion: INFO.modelVersion, samplerVersion: SAMPLER_VERSION, dim: INFO.dim, count: 2 });

    // write happens strictly before patchEntry — the entry only gains embeddingPath once bytes are persisted.
    expect(events).toEqual([`write:${embeddingRelativePath("a")}`, "patch:a"]);
  });

  test("image entry: exactly one embedding row with a zero-length shot range", async () => {
    const entry = imageEntry("pic");
    const { host, writes } = makeHost([entry]);
    const { tap, tapCalls } = makeTapFromGrays({ pic: { 0: 42 } });
    const embedding = makeEmbedding();
    const { openMedia } = makeOpenMedia();
    const svc = new MediaIndexingService({ library: host, embedding, sampleFrames: tap, samplerVersion: SAMPLER_VERSION, openMedia, ...FAST });

    svc.start();
    await waitFor(() => expect(writes).toHaveLength(1));

    expect(tapCalls).toEqual([{ id: "pic", times: [0] }]);
    expect(embedding.embedCalls).toHaveLength(1);
    const decoded = decodeEmbeddings(writes[0]!.bytes)!;
    expect(decoded.rows).toEqual([{ time: 0, shotStart: 0, shotEnd: 0, vector: expect.any(Float32Array) }]);
  });
});

describe("MediaIndexingService: model readiness", () => {
  test("waiting-model while the model isn't ready; drains the queue once it flips to ready", async () => {
    const entry = videoEntry("a", { duration: 1, sourceWidth: 10, sourceHeight: 10 });
    const { host, writes } = makeHost([entry]);
    const { tap } = makeTapFromGrays({ a: { 0.5: 100 } });
    const embedding = makeEmbedding({ state: "downloading" });
    const { openMedia } = makeOpenMedia();
    const svc = new MediaIndexingService({ library: host, embedding, sampleFrames: tap, samplerVersion: SAMPLER_VERSION, openMedia, ...FAST });

    svc.start();
    await waitFor(() => expect(svc.status).toEqual({ kind: "waiting-model" }));
    expect(writes).toHaveLength(0);

    (embedding as { state: MediaIndexingEmbedding["state"] }).state = "ready";

    await waitFor(() => expect(writes).toHaveLength(1));
    await waitFor(() => expect(svc.status).toEqual({ kind: "idle" }));
  });
});

describe("MediaIndexingService: status event sequence", () => {
  test("emits indexing{done,total} increments then idle, no waiting-model when already ready", async () => {
    const a = videoEntry("a", { duration: 1, sourceWidth: 10, sourceHeight: 10 });
    const b = videoEntry("b", { duration: 1, sourceWidth: 10, sourceHeight: 10 });
    const { host, writes } = makeHost([a, b]);
    const { tap } = makeTapFromGrays({ a: { 0.5: 1 }, b: { 0.5: 1 } });
    const { openMedia } = makeOpenMedia();
    const svc = new MediaIndexingService({ library: host, embedding: makeEmbedding(), sampleFrames: tap, samplerVersion: SAMPLER_VERSION, openMedia, ...FAST });

    const events: unknown[] = [];
    svc.onStatus((s) => events.push(s));

    svc.start();
    await waitFor(() => expect(writes).toHaveLength(2));
    await waitFor(() => expect(svc.status).toEqual({ kind: "idle" }));

    expect(events).toEqual([
      { kind: "indexing", done: 0, total: 2 },
      { kind: "indexing", done: 1, total: 2 },
      { kind: "indexing", done: 2, total: 2 },
      { kind: "idle" },
    ]);
  });
});

describe("MediaIndexingService: dispose", () => {
  test("dispose mid-queue stops processing — the in-flight entry is discarded, later entries never start", async () => {
    const a = videoEntry("a", { duration: 1, sourceWidth: 10, sourceHeight: 10 });
    const b = videoEntry("b", { duration: 1, sourceWidth: 10, sourceHeight: 10 });
    const { host, writes } = makeHost([a, b]);

    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const tapCalls: string[] = [];
    const tap: FrameTap = async function* (entry, _blobUrl, times) {
      tapCalls.push(entry.id);
      yield { timeSec: times[0]!, rgba: solidRGBA(10), width: 256, height: 256 };
      await gate; // pauses here after entry a's first frame — the test disposes during this pause
      yield { timeSec: times[1] ?? times[0]!, rgba: solidRGBA(10), width: 256, height: 256 };
    };
    const { openMedia } = makeOpenMedia();
    const svc = new MediaIndexingService({ library: host, embedding: makeEmbedding(), sampleFrames: tap, samplerVersion: SAMPLER_VERSION, openMedia, ...FAST });

    svc.start();
    await waitFor(() => expect(tapCalls).toEqual(["a"]));

    svc.dispose();
    expect(svc.status).toEqual({ kind: "idle" });
    releaseGate();

    await new Promise((r) => setTimeout(r, 10));
    expect(writes).toHaveLength(0);
    expect(tapCalls).toEqual(["a"]); // entry b's tap never started
  });
});

describe("MediaIndexingService: per-entry failure isolation", () => {
  test("a failing entry is skipped with one console.warn; the rest still index", async () => {
    const a = videoEntry("a", { duration: 1, sourceWidth: 10, sourceHeight: 10 });
    const b = videoEntry("b", { duration: 1, sourceWidth: 10, sourceHeight: 10 });
    const { host, writes } = makeHost([a, b]);
    const tap: FrameTap = async function* (entry, _blobUrl, times) {
      if (entry.id === "a") throw new Error("tap boom");
      for (const t of times) yield { timeSec: t, rgba: solidRGBA(5), width: 256, height: 256 };
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { openMedia } = makeOpenMedia();
      const svc = new MediaIndexingService({ library: host, embedding: makeEmbedding(), sampleFrames: tap, samplerVersion: SAMPLER_VERSION, openMedia, ...FAST });

      svc.start();
      await waitFor(() => expect(svc.status).toEqual({ kind: "idle" }));

      expect(writes).toHaveLength(1);
      expect(writes[0]!.path).toBe(embeddingRelativePath("b"));
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("MediaIndexingService.reindexIfStale", () => {
  test("forces one entry back into the queue when it's actually stale", async () => {
    const entry = videoEntry("a", { duration: 1, sourceWidth: 10, sourceHeight: 10 });
    const { host, writes } = makeHost([entry]);
    const { tap } = makeTapFromGrays({ a: { 0.5: 3 } });
    const { openMedia } = makeOpenMedia();
    const svc = new MediaIndexingService({ library: host, embedding: makeEmbedding(), sampleFrames: tap, samplerVersion: SAMPLER_VERSION, openMedia, ...FAST });

    svc.reindexIfStale("a");
    await waitFor(() => expect(writes).toHaveLength(1));
  });

  test("no-op when the entry is already current", async () => {
    const entry = videoEntry("a");
    const { host, derived, writes } = makeHost([entry]);
    seedEmbed(derived, entry);
    const { openMedia } = makeOpenMedia(1000);
    const svc = makeService({ library: host, openMedia });

    svc.reindexIfStale("a");
    await new Promise((r) => setTimeout(r, 10));
    expect(writes).toHaveLength(0);
  });

  test("no-op for an unknown entry id", async () => {
    const { host, writes } = makeHost([]);
    const svc = makeService({ library: host });
    svc.reindexIfStale("nope");
    await new Promise((r) => setTimeout(r, 10));
    expect(writes).toHaveLength(0);
  });
});

describe("MediaIndexingService.cachedEmbeddings", () => {
  test("returns the decoded rows for an entry with a valid cached .embed", async () => {
    const entry = videoEntry("a");
    const { host, derived } = makeHost([entry]);
    seedEmbed(derived, entry);
    const svc = makeService({ library: host });

    expect(await svc.cachedEmbeddings("a")).toEqual([]);
  });

  test("null when there's no embeddingPath, an unreadable path, or an unknown id", async () => {
    const entry = videoEntry("a");
    const { host } = makeHost([entry]);
    const svc = makeService({ library: host });

    expect(await svc.cachedEmbeddings("a")).toBeNull();
    expect(await svc.cachedEmbeddings("nope")).toBeNull();
  });
});

describe("IndexingStatusRelay", () => {
  test("getStatus/subscribe track the current service; rewire() re-attaches to a replacement instance", async () => {
    const svcA = makeService({ library: makeHost([]).host });
    const relay = new IndexingStatusRelay(svcA);
    const events: number[] = [];
    relay.subscribe(() => events.push(1));

    const entry = videoEntry("a", { duration: 1, sourceWidth: 10, sourceHeight: 10 });
    const { host: hostB } = makeHost([entry]);
    const { tap } = makeTapFromGrays({ a: { 0.5: 5 } });
    const { openMedia } = makeOpenMedia();
    const svcB = new MediaIndexingService({ library: hostB, embedding: makeEmbedding(), sampleFrames: tap, samplerVersion: SAMPLER_VERSION, openMedia, ...FAST });

    relay.rewire(svcB);
    expect(events.length).toBeGreaterThan(0); // rewire itself notifies (status may have changed across the swap)

    svcB.start();
    await waitFor(() => expect(relay.getStatus()).toEqual({ kind: "idle" }));
    expect(relay.getStatus()).toBe(svcB.status);
  });
});
