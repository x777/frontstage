import { describe, expect, test, vi } from "vitest";
import {
  EditorStore,
  defaultTimeline,
  defaultTransform,
  defaultCrop,
  rippleDeleteRangesOnTrack,
  type Clip,
  type MediaManifest,
  type MediaManifestEntry,
  type RippleRangesOutcome,
  type Timeline,
  type Track,
  type TranscriptionResult,
} from "@frontstage/core";
import { getTranscriptTool, removeWordsTool } from "../src/tools/transcription-tools.js";
import type { ToolContext } from "../src/index.js";

vi.mock("@frontstage/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@frontstage/core")>();
  return { ...actual, rippleDeleteRangesOnTrack: vi.fn(actual.rippleDeleteRangesOnTrack) };
});

type TranscriptionFacade = NonNullable<ToolContext["transcription"]>;

function baseClip(over: Partial<Clip> = {}): Clip {
  return {
    id: "c",
    mediaRef: "m",
    mediaType: "video",
    sourceClipType: "video",
    startFrame: 0,
    durationFrames: 100,
    trimStartFrame: 0,
    trimEndFrame: 0,
    speed: 1,
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    fadeInInterpolation: "linear",
    fadeOutInterpolation: "linear",
    opacity: 1,
    transform: defaultTransform(),
    crop: defaultCrop(),
    ...over,
  };
}

function track(id: string, type: Track["type"], clips: Clip[]): Track {
  return { id, type, muted: false, hidden: false, syncLocked: false, clips };
}

function timelineOf(...tracks: Track[]): Timeline {
  return { ...defaultTimeline(), tracks };
}

function mediaEntry(id: string, over: Partial<MediaManifestEntry> = {}): MediaManifestEntry {
  return {
    id,
    name: `${id}.mp4`,
    type: "video",
    source: { kind: "project", relativePath: `media/${id}.mp4` },
    duration: 10,
    ...over,
  };
}

function manifestOf(...entries: MediaManifestEntry[]): MediaManifest {
  return { version: 2, entries, folders: [] };
}

function transcriptOf(words: TranscriptionResult["words"]): TranscriptionResult {
  return { text: "", words, segments: [] };
}

interface FacadeOpts {
  cached?: Record<string, TranscriptionResult>;
  hasKey?: boolean;
  localReady?: boolean;
  transcribeImpl?: (mediaRef: string, opts?: { language?: string }) => Promise<TranscriptionResult>;
}

function makeFacade(opts: FacadeOpts = {}) {
  const cachedCalls: string[] = [];
  const transcribeCalls: { mediaRef: string; opts?: { language?: string } }[] = [];
  const hasKeyCalls: number[] = [];
  const facade: TranscriptionFacade = {
    cachedTranscript: async (mediaRef) => {
      cachedCalls.push(mediaRef);
      return opts.cached?.[mediaRef] ?? null;
    },
    transcribe: async (mediaRef, o) => {
      transcribeCalls.push({ mediaRef, opts: o });
      if (opts.transcribeImpl) return opts.transcribeImpl(mediaRef, o);
      throw new Error(`no transcribeImpl for ${mediaRef}`);
    },
    hasKey: async () => {
      hasKeyCalls.push(1);
      return opts.hasKey ?? true;
    },
    estimateCredits: () => 1,
    ...(opts.localReady !== undefined ? { localReady: () => opts.localReady! } : {}),
  };
  return { facade, cachedCalls, transcribeCalls, hasKeyCalls };
}

function makeCtx(timeline: Timeline, manifest: MediaManifest, transcription?: TranscriptionFacade): ToolContext {
  return {
    store: new EditorStore(timeline),
    getManifest: () => manifest,
    newId: () => "new-id",
    transcription,
  };
}

function textOf(result: { blocks: { kind: string; text?: string }[] }): string {
  const block = result.blocks[0];
  return block?.kind === "text" ? (block.text ?? "") : "";
}

describe("get_transcript tool", () => {
  test("has the correct name", () => {
    expect(getTranscriptTool().name).toBe("get_transcript");
  });

  test("errors when ctx.transcription is absent", async () => {
    const tl = timelineOf(track("t0", "video", [baseClip({ id: "v1" })]));
    const ctx = makeCtx(tl, manifestOf(mediaEntry("m", { hasAudio: true })));
    const result = await getTranscriptTool().run({}, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("not available");
  });

  test("errors when startFrame is not less than endFrame", async () => {
    const tl = timelineOf(track("t0", "video", [baseClip({ id: "v1" })]));
    const { facade } = makeFacade();
    const ctx = makeCtx(tl, manifestOf(mediaEntry("m", { hasAudio: true })), facade);
    const result = await getTranscriptTool().run({ startFrame: 10, endFrame: 5 }, ctx);
    expect(result.isError).toBe(true);
  });

  test("empty targets returns an empty, non-error result", async () => {
    const ctx = makeCtx(timelineOf(), manifestOf(), makeFacade().facade);
    const result = await getTranscriptTool().run({}, ctx);
    expect(result.isError).toBe(false);
    const out = JSON.parse(textOf(result));
    expect(out.clips).toEqual([]);
    expect(out.totalWords).toBe(0);
  });

  test("keyless + all-cached works, without ever calling hasKey", async () => {
    const tl = timelineOf(track("t0", "video", [baseClip({ id: "v1", mediaRef: "m1" })]));
    const manifest = manifestOf(mediaEntry("m1", { hasAudio: true }));
    const { facade, hasKeyCalls } = makeFacade({
      cached: { m1: transcriptOf([{ text: "hi", start: 0, end: 0.5 }]) },
      hasKey: false,
    });
    const ctx = makeCtx(tl, manifest, facade);
    const result = await getTranscriptTool().run({}, ctx);
    expect(result.isError).toBe(false);
    expect(hasKeyCalls).toHaveLength(0);
    const out = JSON.parse(textOf(result));
    expect(out.clips[0].words[0][1]).toBe("hi");
  });

  test("keyless + no local (F3): errors with the extended copy naming both Settings and the local model", async () => {
    const tl = timelineOf(track("t0", "video", [baseClip({ id: "v1", mediaRef: "m1" })]));
    const manifest = manifestOf(mediaEntry("m1", { hasAudio: true }));
    const { facade } = makeFacade({ hasKey: false });
    const ctx = makeCtx(tl, manifest, facade);
    const result = await getTranscriptTool().run({}, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Settings");
    expect(textOf(result)).toContain("download the local transcription model");
  });

  test("keyless + local present but not ready (F3): still the extended copy, not silently different", async () => {
    const tl = timelineOf(track("t0", "video", [baseClip({ id: "v1", mediaRef: "m1" })]));
    const manifest = manifestOf(mediaEntry("m1", { hasAudio: true }));
    const { facade } = makeFacade({ hasKey: false, localReady: false });
    const ctx = makeCtx(tl, manifest, facade);
    const result = await getTranscriptTool().run({}, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("download the local transcription model");
  });

  test("keyless + local-ready: transcribes without the key gate", async () => {
    const tl = timelineOf(track("t0", "video", [baseClip({ id: "v1", mediaRef: "m1" })]));
    const manifest = manifestOf(mediaEntry("m1", { hasAudio: true }));
    const { facade } = makeFacade({
      hasKey: false,
      localReady: true,
      transcribeImpl: async () => transcriptOf([{ text: "hi", start: 0, end: 0.5 }]),
    });
    const ctx = makeCtx(tl, manifest, facade);
    const result = await getTranscriptTool().run({}, ctx);
    expect(result.isError).toBe(false);
    const out = JSON.parse(textOf(result));
    expect(out.clips[0].words[0][1]).toBe("hi");
  });

  test("a per-ref transcribe failure is collected into skipped, not batch-failing", async () => {
    const tl = timelineOf(
      track("t0", "video", [baseClip({ id: "v1", mediaRef: "m1" })]),
      track("t1", "video", [baseClip({ id: "v2", mediaRef: "m2", startFrame: 200 })]),
    );
    const manifest = manifestOf(mediaEntry("m1", { hasAudio: true }), mediaEntry("m2", { hasAudio: true }));
    const { facade } = makeFacade({
      transcribeImpl: async (ref) => {
        if (ref === "m2") throw new Error("boom");
        return transcriptOf([{ text: "ok", start: 0, end: 0.5 }]);
      },
    });
    const ctx = makeCtx(tl, manifest, facade);
    const result = await getTranscriptTool().run({}, ctx);
    expect(result.isError).toBe(false);
    const out = JSON.parse(textOf(result));
    expect(out.skipped).toEqual([{ mediaRef: "m2", error: "boom" }]);
    expect(out.clips).toHaveLength(1);
    expect(out.clips[0].clipId).toBe("v1");
  });

  test("hasAudio:false on a video entry drops its target (never queried)", async () => {
    const tl = timelineOf(track("t0", "video", [baseClip({ id: "v1", mediaRef: "m1" })]));
    const manifest = manifestOf(mediaEntry("m1", { hasAudio: false }));
    const { facade, cachedCalls } = makeFacade({ cached: { m1: transcriptOf([{ text: "hi", start: 0, end: 0.5 }]) } });
    const ctx = makeCtx(tl, manifest, facade);
    const result = await getTranscriptTool().run({}, ctx);
    expect(result.isError).toBe(false);
    const out = JSON.parse(textOf(result));
    expect(out.clips).toEqual([]);
    expect(cachedCalls).toEqual([]);
  });

  test("an audio entry (hasAudio undefined) still transcribes", async () => {
    const tl = timelineOf(track("t0", "audio", [baseClip({ id: "a1", mediaRef: "m1", mediaType: "audio", sourceClipType: "audio" })]));
    const manifest = manifestOf(mediaEntry("m1", { type: "audio" }));
    const { facade } = makeFacade({ cached: { m1: transcriptOf([{ text: "hi", start: 0, end: 0.5 }]) } });
    const ctx = makeCtx(tl, manifest, facade);
    const result = await getTranscriptTool().run({}, ctx);
    const out = JSON.parse(textOf(result));
    expect(out.clips).toHaveLength(1);
  });

  test("clipId restricted to an unknown id errors", async () => {
    const tl = timelineOf(track("t0", "video", [baseClip({ id: "v1", mediaRef: "m1" })]));
    const manifest = manifestOf(mediaEntry("m1", { hasAudio: true }));
    const { facade } = makeFacade({ cached: { m1: transcriptOf([]) } });
    const ctx = makeCtx(tl, manifest, facade);
    const result = await getTranscriptTool().run({ clipId: "nope" }, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("nope");
  });

  test("clipId restricts output to that clip's words only", async () => {
    const tl = timelineOf(
      track("t0", "video", [baseClip({ id: "v1", mediaRef: "m1" })]),
      track("t1", "video", [baseClip({ id: "v2", mediaRef: "m2", startFrame: 200 })]),
    );
    const manifest = manifestOf(mediaEntry("m1", { hasAudio: true }), mediaEntry("m2", { hasAudio: true }));
    const { facade, cachedCalls } = makeFacade({
      cached: {
        m1: transcriptOf([{ text: "one", start: 0, end: 0.5 }]),
        m2: transcriptOf([{ text: "two", start: 0, end: 0.5 }]),
      },
    });
    const ctx = makeCtx(tl, manifest, facade);
    const result = await getTranscriptTool().run({ clipId: "v2" }, ctx);
    expect(result.isError).toBe(false);
    const out = JSON.parse(textOf(result));
    expect(out.clips).toHaveLength(1);
    expect(out.clips[0].clipId).toBe("v2");
    expect(cachedCalls).toEqual(["m2"]);
  });

  test("clip grouping + word tuple shape (no speaker)", async () => {
    const tl = timelineOf(track("t0", "video", [baseClip({ id: "v1", mediaRef: "m1", startFrame: 0, durationFrames: 60 })]));
    const manifest = manifestOf(mediaEntry("m1", { hasAudio: true }));
    const { facade } = makeFacade({
      cached: {
        m1: transcriptOf([
          { text: "hi", start: 0, end: 0.5 },
          { text: "there", start: 0.5, end: 1 },
        ]),
      },
    });
    const ctx = makeCtx(tl, manifest, facade);
    const result = await getTranscriptTool().run({}, ctx);
    const out = JSON.parse(textOf(result));
    expect(out.fps).toBe(30);
    expect(out.timing).toBe("projectFrames");
    expect(out.wordFormat).toEqual(["index", "text", "startFrame", "endFrame"]);
    expect(out.clips).toEqual([
      { clipId: "v1", trackIndex: 0, startFrame: 0, endFrame: 60, words: [[0, "hi", 0, 15], [1, "there", 15, 30]] },
    ]);
    expect(out.totalWords).toBe(2);
    expect(out.nextStartFrame).toBeUndefined();
    expect(out.skipped).toBeUndefined();
  });

  test("includes speaker in wordFormat and every row when any word carries one", async () => {
    const tl = timelineOf(track("t0", "video", [baseClip({ id: "v1", mediaRef: "m1", durationFrames: 60 })]));
    const manifest = manifestOf(mediaEntry("m1", { hasAudio: true }));
    const { facade } = makeFacade({
      cached: {
        m1: transcriptOf([
          { text: "hi", start: 0, end: 0.5, speaker: "S1" },
          { text: "there", start: 0.5, end: 1 },
        ]),
      },
    });
    const ctx = makeCtx(tl, manifest, facade);
    const result = await getTranscriptTool().run({}, ctx);
    const out = JSON.parse(textOf(result));
    expect(out.wordFormat).toEqual(["index", "text", "startFrame", "endFrame", "speaker"]);
    expect(out.clips[0].words).toEqual([
      [0, "hi", 0, 15, "S1"],
      [1, "there", 15, 30, null],
    ]);
  });

  test("a word trimmed away before the visible window is excluded", async () => {
    const clip = baseClip({ id: "v1", mediaRef: "m1", startFrame: 100, durationFrames: 50, trimStartFrame: 15 });
    const tl = timelineOf(track("t0", "video", [clip]));
    const manifest = manifestOf(mediaEntry("m1", { hasAudio: true }));
    const { facade } = makeFacade({
      cached: {
        m1: transcriptOf([
          { text: "gone", start: 0.2, end: 0.3 }, // 6 frames < trimStartFrame(15) -> dropped
          { text: "kept", start: 1, end: 1.2 },
        ]),
      },
    });
    const ctx = makeCtx(tl, manifest, facade);
    const result = await getTranscriptTool().run({}, ctx);
    const out = JSON.parse(textOf(result));
    expect(out.clips[0].words.map((w: unknown[]) => w[1])).toEqual(["kept"]);
  });

  test("the window filter keeps words that overlap [startFrame, endFrame), including stragglers", async () => {
    const clip = baseClip({ id: "v1", mediaRef: "m1", startFrame: 0, durationFrames: 100 });
    const tl = timelineOf(track("t0", "video", [clip]));
    const manifest = manifestOf(mediaEntry("m1", { hasAudio: true }));
    const { facade } = makeFacade({
      cached: {
        m1: transcriptOf([
          { text: "before", start: 0, end: 0.1 }, // frames 0-3: fully before window -> dropped
          { text: "straddleLeft", start: 0.2, end: 0.4 }, // frames 6-12: overlaps left edge -> kept
          { text: "straddleRight", start: 0.6, end: 0.9 }, // frames 18-27: overlaps right edge -> kept
          { text: "after", start: 1, end: 1.2 }, // frames 30-36: fully after window -> dropped
        ]),
      },
    });
    const ctx = makeCtx(tl, manifest, facade);
    const result = await getTranscriptTool().run({ startFrame: 10, endFrame: 20 }, ctx);
    const out = JSON.parse(textOf(result));
    expect(out.clips[0].words.map((w: unknown[]) => w[1])).toEqual(["straddleLeft", "straddleRight"]);
  });

  test("dedupes transcription per unique mediaRef across multiple clips", async () => {
    const tl = timelineOf(
      track("t0", "video", [baseClip({ id: "v1", mediaRef: "m1", startFrame: 0, durationFrames: 50 })]),
      track("t1", "video", [baseClip({ id: "v2", mediaRef: "m1", startFrame: 200, durationFrames: 50 })]),
    );
    const manifest = manifestOf(mediaEntry("m1", { hasAudio: true }));
    const { facade, cachedCalls } = makeFacade({ cached: { m1: transcriptOf([{ text: "hi", start: 0, end: 0.5 }]) } });
    const ctx = makeCtx(tl, manifest, facade);
    const result = await getTranscriptTool().run({}, ctx);
    expect(cachedCalls).toEqual(["m1"]);
    const out = JSON.parse(textOf(result));
    expect(out.clips).toHaveLength(2);
  });

  test("a language override skips the cache entirely and forces transcribe", async () => {
    const tl = timelineOf(track("t0", "video", [baseClip({ id: "v1", mediaRef: "m1" })]));
    const manifest = manifestOf(mediaEntry("m1", { hasAudio: true }));
    const { facade, cachedCalls, transcribeCalls } = makeFacade({
      cached: { m1: transcriptOf([{ text: "auto", start: 0, end: 0.5 }]) },
      transcribeImpl: async () => transcriptOf([{ text: "es-version", start: 0, end: 0.5 }]),
    });
    const ctx = makeCtx(tl, manifest, facade);
    const result = await getTranscriptTool().run({ language: "es" }, ctx);
    expect(result.isError).toBe(false);
    expect(cachedCalls).toEqual([]);
    expect(transcribeCalls).toEqual([{ mediaRef: "m1", opts: { language: "es" } }]);
    const out = JSON.parse(textOf(result));
    expect(out.clips[0].words[0][1]).toBe("es-version");
  });

  test("pages at 10,000 words with a correct nextStartFrame and totalWords", async () => {
    const wordCount = 10005;
    const words: TranscriptionResult["words"] = Array.from({ length: wordCount }, (_, i) => ({
      text: `w${i}`,
      start: i / 30,
      end: (i + 0.5) / 30,
    }));
    const clip = baseClip({ id: "v1", mediaRef: "m1", startFrame: 0, durationFrames: 20000 });
    const tl = timelineOf(track("t0", "video", [clip]));
    const manifest = manifestOf(mediaEntry("m1", { hasAudio: true }));
    const { facade } = makeFacade({ cached: { m1: transcriptOf(words) } });
    const ctx = makeCtx(tl, manifest, facade);
    const result = await getTranscriptTool().run({}, ctx);
    expect(result.isError).toBe(false);
    const out = JSON.parse(textOf(result));
    expect(out.totalWords).toBe(wordCount);
    expect(out.nextStartFrame).toBe(10000);
    const emittedCount = out.clips.reduce((sum: number, c: { words: unknown[] }) => sum + c.words.length, 0);
    expect(emittedCount).toBe(10000);
  });
});

function trackFrames(t: Track): number {
  return t.clips.reduce((sum, c) => sum + c.durationFrames, 0);
}

function totalDurationFrames(tl: Timeline): number {
  return tl.tracks.reduce((sum, t) => sum + trackFrames(t), 0);
}

// 4 contiguous 10-frame words at 30fps: "one" [0,10) "two" [10,20) "three" [20,30) "four" [30,40).
function fourWordClip(id = "v1", mediaRef = "m1", over: Partial<Clip> = {}) {
  return baseClip({ id, mediaRef, startFrame: 0, durationFrames: 300, ...over });
}
const fourWords: TranscriptionResult["words"] = [
  { text: "one", start: 0, end: 10 / 30 },
  { text: "two", start: 10 / 30, end: 20 / 30 },
  { text: "three", start: 20 / 30, end: 30 / 30 },
  { text: "four", start: 30 / 30, end: 40 / 30 },
];

describe("remove_words tool", () => {
  test("has the correct name", () => {
    expect(removeWordsTool().name).toBe("remove_words");
  });

  test("errors when ctx.transcription is absent", async () => {
    const tl = timelineOf(track("t0", "video", [fourWordClip()]));
    const ctx = makeCtx(tl, manifestOf(mediaEntry("m1", { hasAudio: true })));
    const result = await removeWordsTool().run({ words: [0] }, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("not available");
  });

  test("errors when both words and matches are given", async () => {
    const tl = timelineOf(track("t0", "video", [fourWordClip()]));
    const { facade } = makeFacade();
    const ctx = makeCtx(tl, manifestOf(mediaEntry("m1", { hasAudio: true })), facade);
    const result = await removeWordsTool().run({ words: [0], matches: ["one"] }, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("not both");
  });

  test("errors when neither words nor matches are given", async () => {
    const tl = timelineOf(track("t0", "video", [fourWordClip()]));
    const { facade } = makeFacade();
    const ctx = makeCtx(tl, manifestOf(mediaEntry("m1", { hasAudio: true })), facade);
    const result = await removeWordsTool().run({}, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("words or matches");
  });

  test("errors when words is an empty array", async () => {
    const tl = timelineOf(track("t0", "video", [fourWordClip()]));
    const { facade } = makeFacade();
    const ctx = makeCtx(tl, manifestOf(mediaEntry("m1", { hasAudio: true })), facade);
    const result = await removeWordsTool().run({ words: [] }, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("must not be empty");
  });

  test("index selection removes exactly that word's frames, closes the gap, and one undo restores", async () => {
    const tl = timelineOf(track("t0", "video", [fourWordClip()]));
    const manifest = manifestOf(mediaEntry("m1", { hasAudio: true }));
    const { facade } = makeFacade({ cached: { m1: transcriptOf(fourWords) } });
    const ctx = makeCtx(tl, manifest, facade);

    const result = await removeWordsTool().run({ words: [2] }, ctx); // "three"
    expect(result.isError).toBe(false);
    const out = JSON.parse(textOf(result));
    expect(out.removedWords).toBe(1);
    expect(out.removedFrames).toBe(10); // no padding: neighbours are contiguous
    expect(out.tracksEdited).toBe(1);
    expect(out.cutAggressiveness).toBe("balanced");
    expect(out.removedText).toBe("three");
    expect(out.indicesIgnored).toBeUndefined();

    const after = ctx.store.getSnapshot().timeline;
    expect(totalDurationFrames(after)).toBe(300 - out.removedFrames);
    expect(ctx.store.canUndo()).toBe(true);

    ctx.store.undo();
    const restored = ctx.store.getSnapshot().timeline;
    expect(totalDurationFrames(restored)).toBe(300);
    expect(restored.tracks[0]!.clips).toHaveLength(1);
    expect(restored.tracks[0]!.clips[0]!.startFrame).toBe(0);
    expect(restored.tracks[0]!.clips[0]!.durationFrames).toBe(300);
  });

  test("an inclusive [start, end] span selects the whole run", async () => {
    const tl = timelineOf(track("t0", "video", [fourWordClip()]));
    const manifest = manifestOf(mediaEntry("m1", { hasAudio: true }));
    const { facade } = makeFacade({ cached: { m1: transcriptOf(fourWords) } });
    const ctx = makeCtx(tl, manifest, facade);

    const result = await removeWordsTool().run({ words: [[1, 3]] }, ctx); // "two three four"
    expect(result.isError).toBe(false);
    const out = JSON.parse(textOf(result));
    expect(out.removedWords).toBe(3);
    expect(out.removedText).toBe("two three four");
    const after = ctx.store.getSnapshot().timeline;
    expect(totalDurationFrames(after)).toBe(300 - out.removedFrames);
  });

  test("matches selection normalizes punctuation and case", async () => {
    const tl = timelineOf(track("t0", "video", [fourWordClip()]));
    const manifest = manifestOf(mediaEntry("m1", { hasAudio: true }));
    const words: TranscriptionResult["words"] = [
      { text: "Um,", start: 0, end: 0.2 },
      { text: "so", start: 0.2, end: 0.4 },
      { text: "yeah", start: 0.4, end: 0.6 },
    ];
    const { facade } = makeFacade({ cached: { m1: transcriptOf(words) } });
    const ctx = makeCtx(tl, manifest, facade);

    const result = await removeWordsTool().run({ matches: ["um"] }, ctx);
    expect(result.isError).toBe(false);
    const out = JSON.parse(textOf(result));
    expect(out.removedWords).toBe(1);
    expect(out.removedText).toBe("Um,"); // original casing/punctuation preserved in the report
  });

  test("empty selection (no matches found) is ok, not an error, and mutates nothing", async () => {
    const tl = timelineOf(track("t0", "video", [fourWordClip()]));
    const manifest = manifestOf(mediaEntry("m1", { hasAudio: true }));
    const { facade } = makeFacade({ cached: { m1: transcriptOf(fourWords) } });
    const ctx = makeCtx(tl, manifest, facade);

    const result = await removeWordsTool().run({ matches: ["zzz"] }, ctx);
    expect(result.isError).toBe(false);
    expect(textOf(result)).toBe("No matching words found.");
    expect(ctx.store.canUndo()).toBe(false);
  });

  test("out-of-range indices are collected into indicesIgnored, not fatal", async () => {
    const tl = timelineOf(track("t0", "video", [fourWordClip()]));
    const manifest = manifestOf(mediaEntry("m1", { hasAudio: true }));
    const { facade } = makeFacade({ cached: { m1: transcriptOf(fourWords) } });
    const ctx = makeCtx(tl, manifest, facade);

    const result = await removeWordsTool().run({ words: [0, 999] }, ctx);
    expect(result.isError).toBe(false);
    const out = JSON.parse(textOf(result));
    expect(out.removedWords).toBe(1);
    expect(out.indicesIgnored).toEqual([999]);
  });

  test("cutAggressiveness defaults to balanced and is echoed back when set explicitly", async () => {
    const tl = timelineOf(track("t0", "video", [fourWordClip()]));
    const manifest = manifestOf(mediaEntry("m1", { hasAudio: true }));
    const { facade } = makeFacade({ cached: { m1: transcriptOf(fourWords) } });
    const ctx = makeCtx(tl, manifest, facade);

    const result = await removeWordsTool().run({ words: [2], cutAggressiveness: "tight" }, ctx);
    const out = JSON.parse(textOf(result));
    expect(out.cutAggressiveness).toBe("tight");
  });

  test("removedText is truncated to ~200 chars with an ellipsis", async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      text: `word${i}`,
      start: i * 0.2,
      end: i * 0.2 + 0.1,
    }));
    const tl = timelineOf(track("t0", "video", [fourWordClip("v1", "m1", { durationFrames: 2000 })]));
    const manifest = manifestOf(mediaEntry("m1", { hasAudio: true }));
    const { facade } = makeFacade({ cached: { m1: transcriptOf(many) } });
    const ctx = makeCtx(tl, manifest, facade);

    const result = await removeWordsTool().run({ words: [[0, 59]] }, ctx);
    expect(result.isError).toBe(false);
    const out = JSON.parse(textOf(result));
    expect(out.removedWords).toBe(60);
    expect(out.removedText.length).toBeLessThanOrEqual(201);
    expect(out.removedText.endsWith("…")).toBe(true);
  });

  function twoLinkableClips(linkGroupId?: { a: string; b: string }) {
    // Both audio-type (e.g. two synced mic feeds) so transcriptTargets' video/linked-audio dedupe
    // never collapses them to one target, regardless of a shared linkGroupId.
    const clipA = baseClip({
      id: "ca", mediaRef: "m1", startFrame: 0, durationFrames: 300,
      mediaType: "audio", sourceClipType: "audio", linkGroupId: linkGroupId?.a,
    });
    const clipB = baseClip({
      id: "cb", mediaRef: "m2", startFrame: 0, durationFrames: 300,
      mediaType: "audio", sourceClipType: "audio", linkGroupId: linkGroupId?.b,
    });
    const tl = timelineOf(track("ta", "audio", [clipA]), track("tb", "audio", [clipB]));
    const manifest = manifestOf(mediaEntry("m1", { type: "audio" }), mediaEntry("m2", { type: "audio" }));
    const sharedWords: TranscriptionResult["words"] = [
      { text: "hi", start: 0, end: 0.5 },
      { text: "there", start: 0.5, end: 1 },
    ];
    const { facade } = makeFacade({ cached: { m1: transcriptOf(sharedWords), m2: transcriptOf(sharedWords) } });
    return { tl, manifest, facade };
  }

  test("multi-track selection without a shared link group refuses, store untouched", async () => {
    const { tl, manifest, facade } = twoLinkableClips();
    const ctx = makeCtx(tl, manifest, facade);
    const before = ctx.store.getSnapshot().timeline;

    const result = await removeWordsTool().run({ matches: ["hi"] }, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("multiple tracks without a shared link group");
    expect(ctx.store.getSnapshot().timeline).toBe(before);
    expect(ctx.store.canUndo()).toBe(false);
  });

  test("multi-track selection with a shared link group succeeds atomically — one undo restores both tracks", async () => {
    const { tl, manifest, facade } = twoLinkableClips({ a: "g1", b: "g1" });
    const ctx = makeCtx(tl, manifest, facade);

    const result = await removeWordsTool().run({ matches: ["hi"] }, ctx);
    expect(result.isError).toBe(false);
    const out = JSON.parse(textOf(result));
    expect(out.removedWords).toBe(2); // "hi" selected on both linked clips
    expect(out.tracksEdited).toBe(2);
    expect(out.removedFrames).toBe(15);

    const after = ctx.store.getSnapshot().timeline;
    expect(trackFrames(after.tracks[0]!)).toBe(300 - 15);
    expect(trackFrames(after.tracks[1]!)).toBe(300 - 15);
    expect(ctx.store.canUndo()).toBe(true);

    ctx.store.undo();
    const restored = ctx.store.getSnapshot().timeline;
    expect(trackFrames(restored.tracks[0]!)).toBe(300);
    expect(trackFrames(restored.tracks[1]!)).toBe(300);
  });

  test("a refusal from the ripple engine aborts the whole command — nothing dispatched", async () => {
    const tl = timelineOf(track("t0", "video", [fourWordClip()]));
    const manifest = manifestOf(mediaEntry("m1", { hasAudio: true }));
    const { facade } = makeFacade({ cached: { m1: transcriptOf(fourWords) } });
    const ctx = makeCtx(tl, manifest, facade);

    const mocked = vi.mocked(rippleDeleteRangesOnTrack);
    const refusal: RippleRangesOutcome = { kind: "refused", reason: "engineered refusal" };
    mocked.mockReturnValueOnce(refusal);

    const result = await removeWordsTool().run({ words: [2] }, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("engineered refusal");
    expect(ctx.store.canUndo()).toBe(false);
    expect(ctx.store.getSnapshot().timeline.tracks[0]!.clips).toHaveLength(1);
  });
});
