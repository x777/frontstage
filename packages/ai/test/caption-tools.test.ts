import { describe, expect, test } from "vitest";
import {
  EditorStore,
  defaultTimeline,
  defaultTransform,
  defaultCrop,
  findClip,
  type Clip,
  type MediaManifest,
  type MediaManifestEntry,
  type Timeline,
  type Track,
  type TranscriptionResult,
} from "@palmier/core";
import { addCaptionsTool } from "../src/tools/caption-tools.js";
import type { ToolContext } from "../src/index.js";

type TranscriptionFacade = NonNullable<ToolContext["transcription"]>;

function baseClip(over: Partial<Clip> = {}): Clip {
  return {
    id: "c",
    mediaRef: "m",
    mediaType: "video",
    sourceClipType: "video",
    startFrame: 0,
    durationFrames: 300, // 10s @ 30fps
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

function transcriptOf(words: TranscriptionResult["words"], segments: TranscriptionResult["segments"] = []): TranscriptionResult {
  return { text: "", words, segments };
}

interface FacadeOpts {
  cached?: Record<string, TranscriptionResult>;
  hasKey?: boolean;
  transcribeImpl?: (mediaRef: string, opts?: { language?: string }) => Promise<TranscriptionResult>;
  estimateCredits?: (durationSeconds: number) => number;
  measureText?: TranscriptionFacade["measureText"];
}

function makeFacade(opts: FacadeOpts = {}) {
  const measureCalls: string[] = [];
  const facade: TranscriptionFacade = {
    cachedTranscript: async (mediaRef) => opts.cached?.[mediaRef] ?? null,
    transcribe: async (mediaRef, o) => {
      if (opts.transcribeImpl) return opts.transcribeImpl(mediaRef, o);
      throw new Error(`no transcribeImpl for ${mediaRef}`);
    },
    hasKey: async () => opts.hasKey ?? true,
    estimateCredits: opts.estimateCredits ?? (() => 1),
    ...(opts.measureText
      ? {
          measureText: (text, style) => {
            measureCalls.push(text);
            return opts.measureText!(text, style);
          },
        }
      : {}),
  };
  return { facade, measureCalls };
}

function makeCtx(timeline: Timeline, manifest: MediaManifest, transcription?: TranscriptionFacade, over: Partial<ToolContext> = {}): ToolContext {
  return {
    store: new EditorStore(timeline),
    getManifest: () => manifest,
    newId: () => `gen-${idCounter++}`,
    transcription,
    ...over,
  };
}

let idCounter = 0;

function textOf(result: { blocks: { kind: string; text?: string }[] }): string {
  const block = result.blocks[0];
  return block?.kind === "text" ? (block.text ?? "") : "";
}

function textClips(store: EditorStore): Clip[] {
  return store.getSnapshot().timeline.tracks.flatMap((t) => t.clips).filter((c) => c.mediaType === "text");
}

describe("add_captions tool", () => {
  test("has the correct name", () => {
    expect(addCaptionsTool().name).toBe("add_captions");
  });

  test("errors when ctx.transcription is absent", async () => {
    const tl = timelineOf(track("t0", "video", [baseClip({ id: "v1" })]));
    const ctx = makeCtx(tl, manifestOf(mediaEntry("m", { hasAudio: true })));
    const result = await addCaptionsTool().run({}, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("not available");
  });

  test("no transcribable clips on the timeline errors", async () => {
    const ctx = makeCtx(timelineOf(), manifestOf(), makeFacade().facade);
    const result = await addCaptionsTool().run({}, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("no transcribable clips");
  });

  test("keyless + all-cached works, without a confirmation gate even at a huge estimate", async () => {
    const tl = timelineOf(track("t0", "video", [baseClip({ id: "v1", mediaRef: "m1" })]));
    const manifest = manifestOf(mediaEntry("m1", { hasAudio: true, duration: 999 }));
    const { facade } = makeFacade({
      cached: { m1: transcriptOf([{ text: "hi", start: 0, end: 0.5 }, { text: "there", start: 0.5, end: 1 }]) },
      hasKey: false,
      estimateCredits: () => 999999, // would obviously gate if ever consulted
    });
    const ctx = makeCtx(tl, manifest, facade);
    const result = await addCaptionsTool().run({}, ctx);
    expect(result.isError).toBe(false);
    const out = JSON.parse(textOf(result));
    expect(out.captionsAdded).toBeGreaterThan(0);
    expect(out.trackIndex).toBe(0);
    expect(typeof out.captionGroupId).toBe("string");
  });

  test("keyless + an uncached ref errors, naming Settings", async () => {
    const tl = timelineOf(track("t0", "video", [baseClip({ id: "v1", mediaRef: "m1" })]));
    const manifest = manifestOf(mediaEntry("m1", { hasAudio: true }));
    const { facade } = makeFacade({ hasKey: false });
    const ctx = makeCtx(tl, manifest, facade);
    const result = await addCaptionsTool().run({}, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("Settings");
  });

  test("an uncached estimate over the default threshold (no ctx.generation) requires confirm", async () => {
    const tl = timelineOf(track("t0", "video", [baseClip({ id: "v1", mediaRef: "m1" })]));
    const manifest = manifestOf(mediaEntry("m1", { hasAudio: true, duration: 10 }));
    const { facade } = makeFacade({
      estimateCredits: (d) => d * 10, // 10 * 10 = 100 > default threshold (50)
      transcribeImpl: async () => transcriptOf([{ text: "hi", start: 0, end: 0.5 }]),
    });
    const ctx = makeCtx(tl, manifest, facade);
    const result = await addCaptionsTool().run({}, ctx);
    expect(result.isError).toBe(false);
    expect(textOf(result)).toContain("Confirmation required");
    expect(ctx.store.canUndo()).toBe(false); // nothing dispatched yet
  });

  test("confirm:true proceeds past the gate and dispatches", async () => {
    const tl = timelineOf(track("t0", "video", [baseClip({ id: "v1", mediaRef: "m1" })]));
    const manifest = manifestOf(mediaEntry("m1", { hasAudio: true, duration: 10 }));
    const { facade } = makeFacade({
      estimateCredits: (d) => d * 10,
      transcribeImpl: async () => transcriptOf([{ text: "hi", start: 0, end: 0.5 }, { text: "there", start: 0.5, end: 1 }]),
    });
    const ctx = makeCtx(tl, manifest, facade);
    const result = await addCaptionsTool().run({ confirm: true }, ctx);
    expect(result.isError).toBe(false);
    const out = JSON.parse(textOf(result));
    expect(out.captionsAdded).toBeGreaterThan(0);
    expect(ctx.store.canUndo()).toBe(true);
  });

  test("a custom ctx.generation.confirmThreshold is honored over the default", async () => {
    const tl = timelineOf(track("t0", "video", [baseClip({ id: "v1", mediaRef: "m1" })]));
    const manifest = manifestOf(mediaEntry("m1", { hasAudio: true, duration: 1 }));
    const { facade } = makeFacade({ estimateCredits: () => 5 });
    const ctx = makeCtx(tl, manifest, facade, {
      generation: {
        hasKey: async () => true,
        addPlaceholder: () => {},
        startJob: async () => ({ jobId: "x" }),
        confirmThreshold: 1, // lower than the default 50, so 5 credits now gates
      },
    });
    const result = await addCaptionsTool().run({}, ctx);
    expect(textOf(result)).toContain("Confirmation required");
  });

  test("all uncached transcriptions failing returns an error, nothing dispatched", async () => {
    const tl = timelineOf(track("t0", "video", [baseClip({ id: "v1", mediaRef: "m1" })]));
    const manifest = manifestOf(mediaEntry("m1", { hasAudio: true }));
    const { facade } = makeFacade({
      transcribeImpl: async () => { throw new Error("boom"); },
    });
    const ctx = makeCtx(tl, manifest, facade);
    const result = await addCaptionsTool().run({}, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("boom");
    expect(ctx.store.canUndo()).toBe(false);
  });

  test("a per-ref transcribe failure is collected into skipped, the rest still proceeds", async () => {
    const tl = timelineOf(
      track("t0", "video", [baseClip({ id: "v1", mediaRef: "m1" })]),
      track("t1", "video", [baseClip({ id: "v2", mediaRef: "m2" })]),
    );
    const manifest = manifestOf(mediaEntry("m1", { hasAudio: true }), mediaEntry("m2", { hasAudio: true }));
    const { facade } = makeFacade({
      transcribeImpl: async (ref) => {
        if (ref === "m2") throw new Error("network error");
        return transcriptOf([{ text: "hi", start: 0, end: 0.5 }, { text: "there", start: 0.5, end: 1 }]);
      },
    });
    const ctx = makeCtx(tl, manifest, facade);
    const result = await addCaptionsTool().run({}, ctx);
    expect(result.isError).toBe(false);
    const out = JSON.parse(textOf(result));
    expect(out.skipped).toEqual([{ mediaRef: "m2", error: "network error" }]);
    expect(out.captionsAdded).toBeGreaterThan(0);
  });

  test("explicit clipIds restricts targets regardless of word counts elsewhere", async () => {
    const tl = timelineOf(
      track("t0", "video", [baseClip({ id: "v1", mediaRef: "m1" })]),
      track("t1", "video", [baseClip({ id: "v2", mediaRef: "m2" })]),
    );
    const manifest = manifestOf(mediaEntry("m1", { hasAudio: true }), mediaEntry("m2", { hasAudio: true }));
    const { facade } = makeFacade({
      cached: {
        // m1 has far more words, but clipIds explicitly asks for v2 only.
        m1: transcriptOf([
          { text: "a", start: 1, end: 1.2 }, { text: "b", start: 2, end: 2.2 }, { text: "c", start: 3, end: 3.2 },
        ]),
        m2: transcriptOf([{ text: "only", start: 1, end: 1.5 }]),
      },
    });
    const ctx = makeCtx(tl, manifest, facade);
    const result = await addCaptionsTool().run({ clipIds: ["v2"] }, ctx);
    expect(result.isError).toBe(false);
    const clips = textClips(ctx.store);
    expect(clips).toHaveLength(1);
    expect(clips[0]!.textContent).toBe("only");
  });

  test("auto-detect (no clipIds) restricts to the dominant (wordier) speech track", async () => {
    const tl = timelineOf(
      track("t0", "video", [baseClip({ id: "v1", mediaRef: "m1" })]),
      track("t1", "video", [baseClip({ id: "v2", mediaRef: "m2" })]),
    );
    const manifest = manifestOf(mediaEntry("m1", { hasAudio: true }), mediaEntry("m2", { hasAudio: true }));
    const { facade } = makeFacade({
      cached: {
        m1: transcriptOf([
          { text: "one", start: 1, end: 1.2 }, { text: "two", start: 3, end: 3.2 }, { text: "three", start: 5, end: 5.2 },
        ]),
        m2: transcriptOf([{ text: "solo", start: 1, end: 1.5 }]),
      },
    });
    const ctx = makeCtx(tl, manifest, facade);
    const result = await addCaptionsTool().run({}, ctx);
    expect(result.isError).toBe(false);
    const clips = textClips(ctx.store);
    // Only track 0's (m1's) speech should have been captioned.
    expect(clips.every((c) => c.textContent !== "solo")).toBe(true);
    expect(clips.some((c) => c.textContent?.includes("one"))).toBe(true);
  });

  test("textCase: upper uppercases every produced phrase", async () => {
    const tl = timelineOf(track("t0", "video", [baseClip({ id: "v1", mediaRef: "m1" })]));
    const manifest = manifestOf(mediaEntry("m1", { hasAudio: true }));
    const { facade } = makeFacade({
      cached: { m1: transcriptOf([{ text: "hi", start: 0, end: 0.5 }, { text: "there", start: 0.5, end: 1 }]) },
    });
    const ctx = makeCtx(tl, manifest, facade);
    const result = await addCaptionsTool().run({ textCase: "upper" }, ctx);
    expect(result.isError).toBe(false);
    const clips = textClips(ctx.store);
    expect(clips[0]!.textContent).toBe("HI THERE");
  });

  test("the window filter restricts to the clip's visible SOURCE span (trim/speed), not the whole transcript", async () => {
    // trimStartFrame 15 (0.5s), 60 frames @ 30fps consumed (2s) -> visible window [0.5s, 2.5s).
    const clip = baseClip({ id: "v1", mediaRef: "m1", startFrame: 0, durationFrames: 60, trimStartFrame: 15 });
    const tl = timelineOf(track("t0", "video", [clip]));
    const manifest = manifestOf(mediaEntry("m1", { hasAudio: true }));
    const { facade } = makeFacade({
      cached: {
        m1: transcriptOf([
          { text: "before", start: 0.1, end: 0.2 }, // fully before the window -> excluded
          { text: "kept", start: 1, end: 1.2 },      // inside -> included
          { text: "after", start: 3, end: 3.2 },      // fully after the window -> excluded
        ]),
      },
    });
    const ctx = makeCtx(tl, manifest, facade);
    const result = await addCaptionsTool().run({}, ctx);
    expect(result.isError).toBe(false);
    const clips = textClips(ctx.store);
    expect(clips).toHaveLength(1);
    expect(clips[0]!.textContent).toBe("kept");
  });

  test("uses ctx.transcription.measureText when the facade provides it, instead of the heuristic", async () => {
    const tl = timelineOf(track("t0", "video", [baseClip({ id: "v1", mediaRef: "m1" })]));
    const manifest = manifestOf(mediaEntry("m1", { hasAudio: true }));
    const { facade, measureCalls } = makeFacade({
      cached: { m1: transcriptOf([{ text: "hi", start: 0, end: 0.5 }, { text: "there", start: 0.5, end: 1 }]) },
      measureText: () => 0.1, // always fits -> one phrase
    });
    const ctx = makeCtx(tl, manifest, facade);
    const result = await addCaptionsTool().run({}, ctx);
    expect(result.isError).toBe(false);
    expect(measureCalls.length).toBeGreaterThan(0);
  });

  test("falls back to the character-count heuristic when measureText is absent, splitting long text", async () => {
    // fontSize default 48 -> heuristic fits up to floor(0.9 * 1920 / (48*0.55)) = 65 chars.
    // 8 six-char words + spaces = 55 chars fits; adding enough extra text forces a split.
    const longPhrase = Array.from({ length: 20 }, (_, i) => `word${i}`).join(" "); // way over 65 chars
    const words = longPhrase.split(" ").map((w, i) => ({ text: w, start: i, end: i + 0.5 }));
    const tl = timelineOf(track("t0", "video", [baseClip({ id: "v1", mediaRef: "m1", durationFrames: 3000 })]));
    const manifest = manifestOf(mediaEntry("m1", { hasAudio: true }));
    const { facade } = makeFacade({ cached: { m1: transcriptOf(words) } });
    const ctx = makeCtx(tl, manifest, facade);
    const result = await addCaptionsTool().run({}, ctx);
    expect(result.isError).toBe(false);
    const clips = textClips(ctx.store);
    expect(clips.length).toBeGreaterThan(1); // the long phrase had to split
  });

  test("no speech in the target window returns a non-error message and dispatches nothing", async () => {
    const clip = baseClip({ id: "v1", mediaRef: "m1", startFrame: 0, durationFrames: 30 }); // 1s window
    const tl = timelineOf(track("t0", "video", [clip]));
    const manifest = manifestOf(mediaEntry("m1", { hasAudio: true }));
    const { facade } = makeFacade({ cached: { m1: transcriptOf([{ text: "late", start: 5, end: 5.5 }]) } });
    const ctx = makeCtx(tl, manifest, facade);
    const result = await addCaptionsTool().run({}, ctx);
    expect(result.isError).toBe(false);
    expect(textOf(result)).toContain("No captions were generated");
    expect(ctx.store.canUndo()).toBe(false);
  });

  test("one undo restores the timeline to before add_captions ran (multiple specs, one undo step)", async () => {
    const tl = timelineOf(track("t0", "video", [baseClip({ id: "v1", mediaRef: "m1" })]));
    const manifest = manifestOf(mediaEntry("m1", { hasAudio: true }));
    const { facade } = makeFacade({
      cached: {
        m1: transcriptOf([
          { text: "hello", start: 0, end: 0.5 },
          { text: "there", start: 1, end: 1.5 },
          { text: "friend", start: 4, end: 4.5 },
        ]),
      },
    });
    const ctx = makeCtx(tl, manifest, facade);
    const before = ctx.store.getSnapshot().timeline;
    const result = await addCaptionsTool().run({ maxWords: 1 }, ctx);
    expect(result.isError).toBe(false);
    const out = JSON.parse(textOf(result));
    expect(out.captionsAdded).toBeGreaterThan(1); // maxWords:1 forced a split into multiple clips
    expect(ctx.store.canUndo()).toBe(true);

    ctx.store.undo();
    expect(ctx.store.getSnapshot().timeline).toEqual(before);
    expect(ctx.store.canUndo()).toBe(false);
  });

  test("invalid color hex errors before doing any transcription work", async () => {
    const tl = timelineOf(track("t0", "video", [baseClip({ id: "v1", mediaRef: "m1" })]));
    const manifest = manifestOf(mediaEntry("m1", { hasAudio: true }));
    const { facade } = makeFacade({ transcribeImpl: async () => { throw new Error("should not be called"); } });
    const ctx = makeCtx(tl, manifest, facade);
    const result = await addCaptionsTool().run({ color: "notahex" }, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("invalid color");
  });

  test("style overrides: fontSize/fontName/color land on every created clip's textStyle", async () => {
    const tl = timelineOf(track("t0", "video", [baseClip({ id: "v1", mediaRef: "m1" })]));
    const manifest = manifestOf(mediaEntry("m1", { hasAudio: true }));
    const { facade } = makeFacade({ cached: { m1: transcriptOf([{ text: "hi", start: 0, end: 0.5 }]) } });
    const ctx = makeCtx(tl, manifest, facade);
    const result = await addCaptionsTool().run({ fontSize: 60, fontName: "Impact", color: "#FF0000" }, ctx);
    expect(result.isError).toBe(false);
    const clip = textClips(ctx.store)[0]!;
    expect(clip.textStyle?.fontSize).toBe(60);
    expect(clip.textStyle?.fontName).toBe("Impact");
    expect(clip.textStyle?.color).toEqual({ r: 1, g: 0, b: 0, a: 1 });
  });

  test("animation preset + highlightColor land on every created clip's textAnimation", async () => {
    const tl = timelineOf(track("t0", "video", [baseClip({ id: "v1", mediaRef: "m1" })]));
    const manifest = manifestOf(mediaEntry("m1", { hasAudio: true }));
    const { facade } = makeFacade({ cached: { m1: transcriptOf([{ text: "hi", start: 0, end: 0.5 }]) } });
    const ctx = makeCtx(tl, manifest, facade);
    const result = await addCaptionsTool().run(
      { animation: { preset: "highlightPop" }, highlightColor: "#00FF00" },
      ctx,
    );
    expect(result.isError).toBe(false);
    const clip = textClips(ctx.store)[0]!;
    expect(clip.textAnimation).toEqual({ preset: "highlightPop", highlightColor: { r: 0, g: 1, b: 0, a: 1 } });
  });

  test("all created clips share one captionGroupId and land on a new track at index 0", async () => {
    const tl = timelineOf(track("existing", "video", [baseClip({ id: "v1", mediaRef: "m1" })]));
    const manifest = manifestOf(mediaEntry("m1", { hasAudio: true }));
    const { facade } = makeFacade({
      cached: { m1: transcriptOf([{ text: "hello", start: 0, end: 0.5 }, { text: "friend", start: 4, end: 4.5 }]) },
    });
    const ctx = makeCtx(tl, manifest, facade);
    const result = await addCaptionsTool().run({ maxWords: 1 }, ctx);
    const out = JSON.parse(textOf(result));
    const afterTl = ctx.store.getSnapshot().timeline;
    expect(afterTl.tracks[0]!.type).toBe("video");
    expect(afterTl.tracks[0]!.id).not.toBe("existing");
    expect(afterTl.tracks[1]!.id).toBe("existing");
    const clips = afterTl.tracks[0]!.clips;
    expect(clips.length).toBe(out.captionsAdded);
    expect(clips.every((c) => c.captionGroupId === out.captionGroupId)).toBe(true);
  });
});

// Sanity: findClip still resolves clips placed by add_captions (used by other tools downstream).
describe("add_captions — findClip sanity", () => {
  test("a placed caption clip is findable by id", async () => {
    const tl = timelineOf(track("t0", "video", [baseClip({ id: "v1", mediaRef: "m1" })]));
    const manifest = manifestOf(mediaEntry("m1", { hasAudio: true }));
    const { facade } = makeFacade({ cached: { m1: transcriptOf([{ text: "hi", start: 0, end: 0.5 }]) } });
    const ctx = makeCtx(tl, manifest, facade);
    await addCaptionsTool().run({}, ctx);
    const clip = textClips(ctx.store)[0]!;
    const loc = findClip(ctx.store.getSnapshot().timeline, clip.id);
    expect(loc).not.toBeNull();
  });
});
