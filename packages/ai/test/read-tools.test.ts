import { describe, expect, test } from "vitest";
import {
  EditorStore,
  defaultTimeline,
  defaultTransform,
  defaultCrop,
  type EmbeddingRow,
  type MediaManifest,
  type MediaManifestEntry,
  type Track,
  type Timeline,
  type TranscriptionResult,
} from "@palmier/core";
import {
  ToolExecutor,
  getTimelineTool,
  getMediaTool,
  inspectMediaTool,
  searchMediaTool,
  type ToolContext,
} from "../src/index.js";

// search_media wraps its JSON payload in { note, matches } only when a visual-scope note applies
// (see read-tools.ts) — this unwraps either shape so tests don't care which one came back.
interface SearchHitLike {
  id: string;
  name: string;
  type: string;
  spokenMatches?: { start: number; end: number; text: string }[];
  visualMatches?: { timeSec: number; score: number }[];
}
function matchesOf(text: string): SearchHitLike[] {
  const parsed: unknown = JSON.parse(text);
  return Array.isArray(parsed) ? (parsed as SearchHitLike[]) : (parsed as { matches: SearchHitLike[] }).matches;
}

function makeClip(id: string, mediaRef: string, startFrame: number) {
  return {
    id,
    mediaRef,
    mediaType: "video" as const,
    sourceClipType: "video" as const,
    startFrame,
    durationFrames: 30,
    trimStartFrame: 0,
    trimEndFrame: 0,
    speed: 1,
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    fadeInInterpolation: "linear" as const,
    fadeOutInterpolation: "linear" as const,
    opacity: 1,
    transform: defaultTransform(),
    crop: defaultCrop(),
  };
}

function makeTimeline(): Timeline {
  const clip1 = makeClip("clip-a", "media-1", 0);
  const clip2 = makeClip("clip-b", "media-2", 30);
  const track: Track = {
    id: "track-1",
    type: "video",
    muted: false,
    hidden: false,
    syncLocked: false,
    clips: [clip1, clip2],
  };
  return { ...defaultTimeline(), tracks: [track] };
}

function makeManifest(): MediaManifest {
  return {
    version: 2,
    entries: [
      {
        id: "media-1",
        name: "sunrise.mp4",
        type: "video",
        source: { kind: "external", absolutePath: "/tmp/sunrise.mp4" },
        duration: 10,
      },
      {
        id: "media-2",
        name: "ocean.mp4",
        type: "video",
        source: { kind: "external", absolutePath: "/tmp/ocean.mp4" },
        duration: 15,
      },
    ],
    folders: [],
  };
}

function makeCtx(): ToolContext {
  const manifest = makeManifest();
  const store = new EditorStore(makeTimeline());
  return {
    store,
    getManifest: () => manifest,
    newId: () => "test-id",
  };
}

describe("get_timeline tool", () => {
  test("result is not an error", async () => {
    const ctx = makeCtx();
    const ex = new ToolExecutor([getTimelineTool()], ctx);
    const result = await ex.execute("get_timeline", {});
    expect(result.isError).toBe(false);
  });

  test("result contains clip ids", async () => {
    const ctx = makeCtx();
    const ex = new ToolExecutor([getTimelineTool()], ctx);
    const result = await ex.execute("get_timeline", {});
    const text = result.blocks.map((b) => (b.kind === "text" ? b.text : "")).join("");
    expect(text).toContain("clip-a");
    expect(text).toContain("clip-b");
  });

  test("result contains media names from manifest", async () => {
    const ctx = makeCtx();
    const ex = new ToolExecutor([getTimelineTool()], ctx);
    const result = await ex.execute("get_timeline", {});
    const text = result.blocks.map((b) => (b.kind === "text" ? b.text : "")).join("");
    expect(text).toContain("sunrise.mp4");
    expect(text).toContain("ocean.mp4");
  });

  test("result contains fps and dimensions", async () => {
    const ctx = makeCtx();
    const ex = new ToolExecutor([getTimelineTool()], ctx);
    const result = await ex.execute("get_timeline", {});
    const text = result.blocks.map((b) => (b.kind === "text" ? b.text : "")).join("");
    expect(text).toContain("30");   // fps
    expect(text).toContain("1920"); // width
    expect(text).toContain("1080"); // height
  });
});

describe("get_media tool", () => {
  test("result is not an error", async () => {
    const ctx = makeCtx();
    const ex = new ToolExecutor([getMediaTool()], ctx);
    const result = await ex.execute("get_media", {});
    expect(result.isError).toBe(false);
  });

  test("result contains entry names", async () => {
    const ctx = makeCtx();
    const ex = new ToolExecutor([getMediaTool()], ctx);
    const result = await ex.execute("get_media", {});
    const text = result.blocks.map((b) => (b.kind === "text" ? b.text : "")).join("");
    expect(text).toContain("sunrise.mp4");
    expect(text).toContain("ocean.mp4");
  });

  test("result contains entry ids", async () => {
    const ctx = makeCtx();
    const ex = new ToolExecutor([getMediaTool()], ctx);
    const result = await ex.execute("get_media", {});
    const text = result.blocks.map((b) => (b.kind === "text" ? b.text : "")).join("");
    expect(text).toContain("media-1");
    expect(text).toContain("media-2");
  });
});

describe("inspect_media tool", () => {
  test("unknown id returns error", async () => {
    const ctx = makeCtx();
    const ex = new ToolExecutor([inspectMediaTool()], ctx);
    const result = await ex.execute("inspect_media", { mediaId: "does-not-exist" });
    expect(result.isError).toBe(true);
    const text = result.blocks.map((b) => (b.kind === "text" ? b.text : "")).join("");
    expect(text).toContain("does-not-exist");
  });

  test("known id returns metadata text with name and duration", async () => {
    const ctx = makeCtx();
    const ex = new ToolExecutor([inspectMediaTool()], ctx);
    const result = await ex.execute("inspect_media", { mediaId: "media-1" });
    expect(result.isError).toBe(false);
    const text = result.blocks.map((b) => (b.kind === "text" ? b.text : "")).join("");
    expect(text).toContain("sunrise.mp4");
    expect(text).toContain("10");
    expect(text).toContain("external");
  });

  test("known id returns source path", async () => {
    const ctx = makeCtx();
    const ex = new ToolExecutor([inspectMediaTool()], ctx);
    const result = await ex.execute("inspect_media", { mediaId: "media-2" });
    expect(result.isError).toBe(false);
    const text = result.blocks.map((b) => (b.kind === "text" ? b.text : "")).join("");
    expect(text).toContain("/tmp/ocean.mp4");
  });
});

describe("search_media tool", () => {
  test("substring match returns matching entry id", async () => {
    const ctx = makeCtx();
    const ex = new ToolExecutor([searchMediaTool()], ctx);
    const result = await ex.execute("search_media", { query: "sunrise" });
    expect(result.isError).toBe(false);
    const text = result.blocks.map((b) => (b.kind === "text" ? b.text : "")).join("");
    expect(text).toContain("media-1");
    expect(text).not.toContain("media-2");
  });

  test("case-insensitive match", async () => {
    const ctx = makeCtx();
    const ex = new ToolExecutor([searchMediaTool()], ctx);
    const result = await ex.execute("search_media", { query: "OCEAN" });
    expect(result.isError).toBe(false);
    const text = result.blocks.map((b) => (b.kind === "text" ? b.text : "")).join("");
    expect(text).toContain("media-2");
    expect(text).not.toContain("media-1");
  });

  test("no match returns non-error informative text", async () => {
    const ctx = makeCtx();
    const ex = new ToolExecutor([searchMediaTool()], ctx);
    const result = await ex.execute("search_media", { query: "xyznotfound" });
    expect(result.isError).toBe(false);
    const text = result.blocks.map((b) => (b.kind === "text" ? b.text : "")).join("");
    expect(text).toContain("No media matches");
    expect(text).toContain("xyznotfound");
  });
});

type TranscriptionFacade = NonNullable<ToolContext["transcription"]>;

function makeTranscriptionFacade(byId: Record<string, TranscriptionResult>): {
  facade: TranscriptionFacade;
  transcribeCalls: string[];
  cachedCalls: string[];
} {
  const transcribeCalls: string[] = [];
  const cachedCalls: string[] = [];
  const facade: TranscriptionFacade = {
    cachedTranscript: async (mediaRef) => {
      cachedCalls.push(mediaRef);
      return byId[mediaRef] ?? null;
    },
    transcribe: async (mediaRef) => {
      transcribeCalls.push(mediaRef);
      throw new Error("search_media must never transcribe");
    },
    hasKey: async () => true,
    estimateCredits: () => 1,
  };
  return { facade, transcribeCalls, cachedCalls };
}

function makeManifestWithTranscripts(): MediaManifest {
  return {
    version: 2,
    entries: [
      {
        id: "media-1",
        name: "sunrise.mp4",
        type: "video",
        source: { kind: "external", absolutePath: "/tmp/sunrise.mp4" },
        duration: 10,
        transcriptPath: "media/media-1.transcript.json",
      },
      {
        id: "media-2",
        name: "ocean.mp4",
        type: "video",
        source: { kind: "external", absolutePath: "/tmp/ocean.mp4" },
        duration: 15,
        transcriptPath: "media/media-2.transcript.json",
      },
    ],
    folders: [],
  };
}

function makeScopeCtx(transcription?: TranscriptionFacade): ToolContext {
  return {
    store: new EditorStore(makeTimeline()),
    getManifest: makeManifestWithTranscripts,
    newId: () => "test-id",
    transcription,
  };
}

describe("search_media scope", () => {
  test("scope defaults to both: visual name match still works without a transcription facade", async () => {
    const ex = new ToolExecutor([searchMediaTool()], makeScopeCtx());
    const result = await ex.execute("search_media", { query: "sunrise" });
    expect(result.isError).toBe(false);
    const text = result.blocks.map((b) => (b.kind === "text" ? b.text : "")).join("");
    expect(text).toContain("media-1");
  });

  test("scope='spoken' without a transcription facade errors", async () => {
    const ex = new ToolExecutor([searchMediaTool()], makeScopeCtx());
    const result = await ex.execute("search_media", { query: "hello", scope: "spoken" });
    expect(result.isError).toBe(true);
    const text = result.blocks.map((b) => (b.kind === "text" ? b.text : "")).join("");
    expect(text).toContain("not available");
  });

  test("scope='spoken' matches cached transcript segments and never transcribes", async () => {
    const transcript: TranscriptionResult = { text: "", segments: [{ text: "hello world", start: 1, end: 2 }], words: [] };
    const { facade, transcribeCalls } = makeTranscriptionFacade({ "media-1": transcript });
    const ex = new ToolExecutor([searchMediaTool()], makeScopeCtx(facade));
    const result = await ex.execute("search_media", { query: "hello", scope: "spoken" });
    expect(result.isError).toBe(false);
    const text = result.blocks.map((b) => (b.kind === "text" ? b.text : "")).join("");
    expect(JSON.parse(text)).toEqual([
      { id: "media-1", name: "sunrise.mp4", type: "video", spokenMatches: [{ start: 1, end: 2, text: "hello world" }] },
    ]);
    expect(transcribeCalls).toEqual([]);
  });

  test("spoken match requires every query term to be present in the segment", async () => {
    const transcript: TranscriptionResult = { text: "", segments: [{ text: "hello world", start: 0, end: 1 }], words: [] };
    const { facade } = makeTranscriptionFacade({ "media-1": transcript });
    const ex = new ToolExecutor([searchMediaTool()], makeScopeCtx(facade));
    const result = await ex.execute("search_media", { query: "hello mars", scope: "spoken" });
    expect(result.isError).toBe(false);
    const text = result.blocks.map((b) => (b.kind === "text" ? b.text : "")).join("");
    expect(text).toContain("No media matches");
  });

  test("spoken matching normalizes case and diacritics on both sides", async () => {
    const transcript: TranscriptionResult = { text: "", segments: [{ text: "a nice cafe downtown", start: 0, end: 1 }], words: [] };
    const { facade } = makeTranscriptionFacade({ "media-1": transcript });
    const ex = new ToolExecutor([searchMediaTool()], makeScopeCtx(facade));
    const result = await ex.execute("search_media", { query: "CAFÉ", scope: "spoken" });
    expect(result.isError).toBe(false);
    const text = result.blocks.map((b) => (b.kind === "text" ? b.text : "")).join("");
    expect(text).toContain("media-1");
  });

  test("scope='both' unions visual and spoken hits, merging an entry that matches both", async () => {
    const transcript: TranscriptionResult = { text: "", segments: [{ text: "sunrise footage", start: 0, end: 1 }], words: [] };
    const { facade } = makeTranscriptionFacade({ "media-1": transcript });
    const ex = new ToolExecutor([searchMediaTool()], makeScopeCtx(facade));
    const result = await ex.execute("search_media", { query: "sunrise" });
    expect(result.isError).toBe(false);
    const text = result.blocks.map((b) => (b.kind === "text" ? b.text : "")).join("");
    const matches = matchesOf(text);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.id).toBe("media-1");
    expect(matches[0]!.spokenMatches).toEqual([{ start: 0, end: 1, text: "sunrise footage" }]);
  });

  test("an entry without transcriptPath is never queried for spoken matches", async () => {
    const manifest: MediaManifest = {
      version: 2,
      entries: [{ id: "media-3", name: "no-transcript.mp4", type: "video", source: { kind: "external", absolutePath: "/tmp/x.mp4" }, duration: 5 }],
      folders: [],
    };
    const { facade, cachedCalls } = makeTranscriptionFacade({});
    const ctx: ToolContext = { store: new EditorStore(makeTimeline()), getManifest: () => manifest, newId: () => "test-id", transcription: facade };
    const ex = new ToolExecutor([searchMediaTool()], ctx);
    await ex.execute("search_media", { query: "x", scope: "spoken" });
    expect(cachedCalls).toEqual([]);
  });
});

// ── search_media visual scope: real embedding search (M12C T4) ────────────────

type EmbeddingFacade = NonNullable<ToolContext["embedding"]>;

function makeEmbeddingFacade(opts: { ready: boolean; queryVector?: Float32Array; rows?: Record<string, EmbeddingRow[]> }): {
  facade: EmbeddingFacade;
  calls: { ensureReady: number; embedText: string[]; cached: string[] };
} {
  const calls = { ensureReady: 0, embedText: [] as string[], cached: [] as string[] };
  let ready = opts.ready;
  const facade: EmbeddingFacade = {
    ready: () => ready,
    ensureReady: async () => {
      calls.ensureReady += 1;
      // A real macrotask, not a resolved microtask: if the caller's `await ensureReady()` regressed to
      // fire-and-forget, `ready` would still be false when the caller's next line runs, and the
      // subsequent `embedding.ready()` gate check below would (wrongly) skip the visual search.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      ready = true;
    },
    embedText: async (q) => {
      calls.embedText.push(q);
      return opts.queryVector ?? new Float32Array([1, 0, 0]);
    },
    cachedEmbeddings: async (mediaRef) => {
      calls.cached.push(mediaRef);
      return opts.rows?.[mediaRef] ?? null;
    },
    modelInfo: { model: "test-siglip", modelVersion: "v1", dim: 3 },
  };
  return { facade, calls };
}

function visualEntry(id: string, name: string, overrides: Partial<MediaManifestEntry> = {}): MediaManifestEntry {
  return { id, name, type: "video", source: { kind: "external", absolutePath: `/tmp/${id}.mp4` }, duration: 10, ...overrides };
}

describe("search_media visual scope (embeddings)", () => {
  test("ready facade: ranked matches carry the matched timeSec + score", async () => {
    const manifest: MediaManifest = {
      version: 2,
      entries: [visualEntry("media-a", "storm-clouds.mp4", { embeddingPath: "media/media-a.embed" })],
      folders: [],
    };
    const { facade, calls } = makeEmbeddingFacade({
      ready: true,
      rows: { "media-a": [{ time: 5, shotStart: 0, shotEnd: 10, vector: new Float32Array([1, 0, 0]) }] },
    });
    const ctx: ToolContext = { store: new EditorStore(makeTimeline()), getManifest: () => manifest, newId: () => "test-id", embedding: facade };
    const result = await new ToolExecutor([searchMediaTool()], ctx).execute("search_media", { query: "beach", scope: "visual" });
    expect(result.isError).toBe(false);
    const text = result.blocks.map((b) => (b.kind === "text" ? b.text : "")).join("");
    const matches = matchesOf(text);
    expect(matches).toEqual([{ id: "media-a", name: "storm-clouds.mp4", type: "video", visualMatches: [{ timeSec: 5, score: 1 }] }]);
    expect(calls.embedText).toEqual(["beach"]);
    expect(calls.cached).toEqual(["media-a"]);
  });

  test("merges an embedding-only hit, a name-only hit, and an entry matching both — dedupe + order", async () => {
    const manifest: MediaManifest = {
      version: 2,
      entries: [
        visualEntry("media-a", "storm-clouds.mp4", { embeddingPath: "media/media-a.embed" }), // visual-only
        visualEntry("media-b", "beach-day.mp4"), // name-only, unindexed
        visualEntry("media-c", "beach-sunset.mp4", { embeddingPath: "media/media-c.embed" }), // both
      ],
      folders: [],
    };
    const { facade, calls } = makeEmbeddingFacade({
      ready: true,
      rows: {
        "media-a": [{ time: 5, shotStart: 0, shotEnd: 10, vector: new Float32Array([1, 0, 0]) }],
        "media-c": [{ time: 2, shotStart: 0, shotEnd: 5, vector: new Float32Array([1, 0, 0]) }],
      },
    });
    const ctx: ToolContext = { store: new EditorStore(makeTimeline()), getManifest: () => manifest, newId: () => "test-id", embedding: facade };
    const result = await new ToolExecutor([searchMediaTool()], ctx).execute("search_media", { query: "beach", scope: "visual" });
    expect(result.isError).toBe(false);
    const text = result.blocks.map((b) => (b.kind === "text" ? b.text : "")).join("");
    const matches = matchesOf(text);

    // Name-matched entries keep their original (name-pass) position; a visual-only hit is appended.
    expect(matches.map((m) => m.id)).toEqual(["media-b", "media-c", "media-a"]);
    expect(matches[0]).toEqual({ id: "media-b", name: "beach-day.mp4", type: "video" });
    expect(matches[1]!.visualMatches).toEqual([{ timeSec: 2, score: 1 }]);
    expect(matches[2]!.visualMatches).toEqual([{ timeSec: 5, score: 1 }]);
    expect(calls.cached).not.toContain("media-b"); // unindexed entry is never queried for embeddings
  });

  test("unindexed entries fall back to name matching per-entry even when the facade is ready", async () => {
    const manifest: MediaManifest = {
      version: 2,
      entries: [visualEntry("media-b", "beach-day.mp4")], // no embeddingPath at all
      folders: [],
    };
    const { facade, calls } = makeEmbeddingFacade({ ready: true, rows: {} });
    const ctx: ToolContext = { store: new EditorStore(makeTimeline()), getManifest: () => manifest, newId: () => "test-id", embedding: facade };
    const result = await new ToolExecutor([searchMediaTool()], ctx).execute("search_media", { query: "beach", scope: "visual" });
    expect(result.isError).toBe(false);
    const text = result.blocks.map((b) => (b.kind === "text" ? b.text : "")).join("");
    expect(matchesOf(text)).toEqual([{ id: "media-b", name: "beach-day.mp4", type: "video" }]);
    expect(calls.cached).toEqual([]); // never attempted — no embeddingPath to read
  });

  test("facade absent: falls back to name matching for every entry and notes the degraded state", async () => {
    const manifest: MediaManifest = {
      version: 2,
      entries: [visualEntry("media-a", "storm-clouds.mp4", { embeddingPath: "media/media-a.embed" })],
      folders: [],
    };
    const ctx: ToolContext = { store: new EditorStore(makeTimeline()), getManifest: () => manifest, newId: () => "test-id" };
    const result = await new ToolExecutor([searchMediaTool()], ctx).execute("search_media", { query: "storm", scope: "visual" });
    expect(result.isError).toBe(false);
    const text = result.blocks.map((b) => (b.kind === "text" ? b.text : "")).join("");
    expect(JSON.parse(text)).toEqual({
      note: "visual index unavailable — name matching only",
      matches: [{ id: "media-a", name: "storm-clouds.mp4", type: "video" }],
    });
  });

  test("ready facade with some unindexed candidates: notes indexing may still be in progress", async () => {
    const manifest: MediaManifest = {
      version: 2,
      entries: [visualEntry("media-a", "storm-clouds.mp4", { embeddingPath: "media/media-a.embed" }), visualEntry("media-b", "unrelated.mp4")],
      folders: [],
    };
    const { facade } = makeEmbeddingFacade({
      ready: true,
      rows: { "media-a": [{ time: 5, shotStart: 0, shotEnd: 10, vector: new Float32Array([1, 0, 0]) }] },
    });
    const ctx: ToolContext = { store: new EditorStore(makeTimeline()), getManifest: () => manifest, newId: () => "test-id", embedding: facade };
    const result = await new ToolExecutor([searchMediaTool()], ctx).execute("search_media", { query: "storm", scope: "visual" });
    const text = result.blocks.map((b) => (b.kind === "text" ? b.text : "")).join("");
    const parsed = JSON.parse(text) as { note?: string };
    expect(parsed.note).toBe("some media isn't indexed yet — visual results may improve as indexing completes");
  });
});

describe("search_media visual model download gate", () => {
  test("not-ready facade, no confirm: returns the confirmation-required result, no partial results, no download started", async () => {
    const manifest: MediaManifest = { version: 2, entries: [visualEntry("media-a", "storm-clouds.mp4")], folders: [] };
    const { facade, calls } = makeEmbeddingFacade({ ready: false });
    const ctx: ToolContext = { store: new EditorStore(makeTimeline()), getManifest: () => manifest, newId: () => "test-id", embedding: facade };
    const result = await new ToolExecutor([searchMediaTool()], ctx).execute("search_media", { query: "storm" });
    expect(result.isError).toBe(false);
    const text = result.blocks.map((b) => (b.kind === "text" ? b.text : "")).join("");
    expect(text).toContain("Confirmation required");
    expect(text).toContain("confirm: true");
    expect(text).not.toContain("storm-clouds.mp4");
    expect(calls.ensureReady).toBe(0);
    expect(calls.embedText).toEqual([]);
  });

  test("not-ready facade, scope='spoken': the gate never triggers — visual isn't requested", async () => {
    const transcript: TranscriptionResult = { text: "", segments: [{ text: "storm warning", start: 0, end: 1 }], words: [] };
    const manifest: MediaManifest = {
      version: 2,
      entries: [visualEntry("media-a", "clip.mp4", { transcriptPath: "media/media-a.transcript.json" })],
      folders: [],
    };
    const { facade: transcription } = makeTranscriptionFacade({ "media-a": transcript });
    const { facade: embedding, calls } = makeEmbeddingFacade({ ready: false });
    const ctx: ToolContext = { store: new EditorStore(makeTimeline()), getManifest: () => manifest, newId: () => "test-id", embedding, transcription };
    const result = await new ToolExecutor([searchMediaTool()], ctx).execute("search_media", { query: "storm", scope: "spoken" });
    expect(result.isError).toBe(false);
    const text = result.blocks.map((b) => (b.kind === "text" ? b.text : "")).join("");
    expect(text).not.toContain("Confirmation required");
    expect(text).toContain("media-a");
    expect(calls.ensureReady).toBe(0);
  });

  test("confirm: true downloads via ensureReady, then runs the real visual search", async () => {
    const manifest: MediaManifest = {
      version: 2,
      entries: [visualEntry("media-a", "storm-clouds.mp4", { embeddingPath: "media/media-a.embed" })],
      folders: [],
    };
    const { facade, calls } = makeEmbeddingFacade({
      ready: false,
      rows: { "media-a": [{ time: 5, shotStart: 0, shotEnd: 10, vector: new Float32Array([1, 0, 0]) }] },
    });
    const ctx: ToolContext = { store: new EditorStore(makeTimeline()), getManifest: () => manifest, newId: () => "test-id", embedding: facade };
    const result = await new ToolExecutor([searchMediaTool()], ctx).execute("search_media", {
      query: "beach",
      scope: "visual",
      confirm: true,
    });
    expect(result.isError).toBe(false);
    expect(calls.ensureReady).toBe(1);
    const text = result.blocks.map((b) => (b.kind === "text" ? b.text : "")).join("");
    const matches = matchesOf(text);
    expect(matches).toEqual([{ id: "media-a", name: "storm-clouds.mp4", type: "video", visualMatches: [{ timeSec: 5, score: 1 }] }]);
  });

  test("scope: 'both' + confirm: true: gate is charged exactly once, spoken results still come through", async () => {
    const transcript: TranscriptionResult = { text: "", segments: [{ text: "storm warning", start: 0, end: 1 }], words: [] };
    const manifest: MediaManifest = {
      version: 2,
      entries: [visualEntry("media-a", "clip.mp4", { embeddingPath: "media/media-a.embed", transcriptPath: "media/media-a.transcript.json" })],
      folders: [],
    };
    const { facade: transcription } = makeTranscriptionFacade({ "media-a": transcript });
    const { facade: embedding, calls } = makeEmbeddingFacade({
      ready: false,
      rows: { "media-a": [{ time: 5, shotStart: 0, shotEnd: 10, vector: new Float32Array([1, 0, 0]) }] },
    });
    const ctx: ToolContext = { store: new EditorStore(makeTimeline()), getManifest: () => manifest, newId: () => "test-id", embedding, transcription };
    const result = await new ToolExecutor([searchMediaTool()], ctx).execute("search_media", {
      query: "storm",
      scope: "both",
      confirm: true,
    });
    expect(result.isError).toBe(false);
    expect(calls.ensureReady).toBe(1); // one gate/download for the whole call, not once per scope
    const text = result.blocks.map((b) => (b.kind === "text" ? b.text : "")).join("");
    const matches = matchesOf(text);
    expect(matches).toEqual([
      {
        id: "media-a",
        name: "clip.mp4",
        type: "video",
        visualMatches: [{ timeSec: 5, score: 1 }],
        spokenMatches: [{ start: 0, end: 1, text: "storm warning" }],
      },
    ]);
  });
});
