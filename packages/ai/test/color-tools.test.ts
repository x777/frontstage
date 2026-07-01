import { describe, expect, test } from "vitest";
import {
  EditorStore,
  defaultTimeline,
  defaultTransform,
  defaultCrop,
  findClip,
  type Track,
  type Timeline,
  type MediaManifest,
} from "@palmier/core";
import { applyColorTool, applyEffectTool, inspectColorTool, type ToolContext } from "../src/index.js";

function makeClip(id: string, startFrame = 0) {
  return {
    id,
    mediaRef: "media-1",
    mediaType: "video" as const,
    sourceClipType: "video" as const,
    startFrame,
    durationFrames: 60,
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

function makeTrack(id = "t1"): Track {
  return { id, type: "video", muted: false, hidden: false, syncLocked: false, clips: [makeClip("c1")] };
}

function makeTimeline(): Timeline {
  return { ...defaultTimeline(), tracks: [makeTrack()] };
}

function makeManifest(): MediaManifest {
  return {
    version: 2,
    entries: [{ id: "media-1", name: "clip.mp4", type: "video", source: { kind: "external", absolutePath: "/tmp/clip.mp4" }, duration: 2 }],
    folders: [],
  };
}

let _n = 0;
function makeCtx(store: EditorStore): ToolContext {
  return { store, getManifest: makeManifest, newId: () => `gen-${++_n}` };
}

// ── apply_color ───────────────────────────────────────────────────────────────

describe("apply_color", () => {
  test("sets color.exposure on clip", async () => {
    const store = new EditorStore(makeTimeline());
    const ctx = makeCtx(store);
    const result = await applyColorTool().run({ clipIds: ["c1"], exposure: 0.3 }, ctx);
    expect(result.isError).toBe(false);
    const tl = store.getSnapshot().timeline;
    const loc = findClip(tl, "c1")!;
    const clip = tl.tracks[loc.trackIndex]!.clips[loc.clipIndex]!;
    const expEffect = clip.effects?.find((e) => e.type === "color.exposure");
    expect(expEffect).toBeDefined();
    expect(expEffect?.params["ev"]?.value).toBeCloseTo(0.3);
  });

  test("is exactly ONE undo step and undo restores no effects", async () => {
    const store = new EditorStore(makeTimeline());
    const ctx = makeCtx(store);
    await applyColorTool().run({ clipIds: ["c1"], exposure: 0.5 }, ctx);
    expect(store.canUndo()).toBe(true);
    store.undo();
    const tl = store.getSnapshot().timeline;
    const loc = findClip(tl, "c1")!;
    const clip = tl.tracks[loc.trackIndex]!.clips[loc.clipIndex]!;
    expect(clip.effects).toBeUndefined();
    expect(store.canUndo()).toBe(false);
  });

  test("unknown clipId returns isError:true, store unchanged", async () => {
    const store = new EditorStore(makeTimeline());
    const before = store.getSnapshot().timeline;
    const ctx = makeCtx(store);
    const result = await applyColorTool().run({ clipIds: ["bad"], exposure: 1 }, ctx);
    expect(result.isError).toBe(true);
    expect(store.getSnapshot().timeline).toBe(before);
    expect(store.canUndo()).toBe(false);
  });

  test("neutral exposure (0) produces no effects", async () => {
    const store = new EditorStore(makeTimeline());
    const ctx = makeCtx(store);
    const result = await applyColorTool().run({ clipIds: ["c1"], reset: true }, ctx);
    expect(result.isError).toBe(false);
    // Reset with all neutral values → buildColorStack returns [] → effects = undefined
    const tl = store.getSnapshot().timeline;
    const loc = findClip(tl, "c1")!;
    const clip = tl.tracks[loc.trackIndex]!.clips[loc.clipIndex]!;
    // neutral stack = empty → stored as undefined
    expect(clip.effects).toBeUndefined();
  });

  test("multi-clip: ONE call is ONE undo step that restores ALL clips", async () => {
    const twoClipTimeline: Timeline = {
      ...defaultTimeline(),
      tracks: [
        {
          id: "t1",
          type: "video",
          muted: false,
          hidden: false,
          syncLocked: false,
          clips: [makeClip("c1", 0), makeClip("c2", 60)],
        },
      ],
    };
    const store = new EditorStore(twoClipTimeline);
    const ctx = makeCtx(store);
    const result = await applyColorTool().run({ clipIds: ["c1", "c2"], exposure: 0.3 }, ctx);
    expect(result.isError).toBe(false);

    const tlAfter = store.getSnapshot().timeline;
    const loc1 = findClip(tlAfter, "c1")!;
    const loc2 = findClip(tlAfter, "c2")!;
    const clip1After = tlAfter.tracks[loc1.trackIndex]!.clips[loc1.clipIndex]!;
    const clip2After = tlAfter.tracks[loc2.trackIndex]!.clips[loc2.clipIndex]!;
    expect(clip1After.effects?.find((e) => e.type === "color.exposure")).toBeDefined();
    expect(clip2After.effects?.find((e) => e.type === "color.exposure")).toBeDefined();

    store.undo();
    expect(store.canUndo()).toBe(false);
    const tlUndo = store.getSnapshot().timeline;
    const loc1u = findClip(tlUndo, "c1")!;
    const loc2u = findClip(tlUndo, "c2")!;
    const clip1Undo = tlUndo.tracks[loc1u.trackIndex]!.clips[loc1u.clipIndex]!;
    const clip2Undo = tlUndo.tracks[loc2u.trackIndex]!.clips[loc2u.clipIndex]!;
    expect(clip1Undo.effects).toBeUndefined();
    expect(clip2Undo.effects).toBeUndefined();
  });
});

// ── apply_effect ──────────────────────────────────────────────────────────────

describe("apply_effect", () => {
  test("adds blur.gaussian effect", async () => {
    const store = new EditorStore(makeTimeline());
    const ctx = makeCtx(store);
    const result = await applyEffectTool().run(
      { clipIds: ["c1"], effects: [{ type: "blur.gaussian", params: { radius: 10 } }] },
      ctx,
    );
    expect(result.isError).toBe(false);
    const tl = store.getSnapshot().timeline;
    const loc = findClip(tl, "c1")!;
    const clip = tl.tracks[loc.trackIndex]!.clips[loc.clipIndex]!;
    expect(clip.effects?.some((e) => e.type === "blur.gaussian")).toBe(true);
  });

  test("removes blur.gaussian via remove field", async () => {
    const store = new EditorStore(makeTimeline());
    const ctx = makeCtx(store);
    // Add first
    await applyEffectTool().run(
      { clipIds: ["c1"], effects: [{ type: "blur.gaussian" }] },
      ctx,
    );
    // Then remove
    const result = await applyEffectTool().run({ clipIds: ["c1"], remove: ["blur.gaussian"] }, ctx);
    expect(result.isError).toBe(false);
    const tl = store.getSnapshot().timeline;
    const loc = findClip(tl, "c1")!;
    const clip = tl.tracks[loc.trackIndex]!.clips[loc.clipIndex]!;
    expect(clip.effects).toBeUndefined();
  });

  test("rejects color.* type with isError, store unchanged", async () => {
    const store = new EditorStore(makeTimeline());
    const before = store.getSnapshot().timeline;
    const ctx = makeCtx(store);
    const result = await applyEffectTool().run(
      { clipIds: ["c1"], effects: [{ type: "color.exposure" }] },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(store.getSnapshot().timeline).toBe(before);
    expect(store.canUndo()).toBe(false);
  });

  test("is ONE undo step", async () => {
    const store = new EditorStore(makeTimeline());
    const ctx = makeCtx(store);
    await applyEffectTool().run(
      { clipIds: ["c1"], effects: [{ type: "blur.gaussian" }] },
      ctx,
    );
    expect(store.canUndo()).toBe(true);
    store.undo();
    const tl = store.getSnapshot().timeline;
    const loc = findClip(tl, "c1")!;
    const clip = tl.tracks[loc.trackIndex]!.clips[loc.clipIndex]!;
    expect(clip.effects).toBeUndefined();
    expect(store.canUndo()).toBe(false);
  });

  test("unknown clipId returns isError:true, store unchanged", async () => {
    const store = new EditorStore(makeTimeline());
    const before = store.getSnapshot().timeline;
    const ctx = makeCtx(store);
    const result = await applyEffectTool().run(
      { clipIds: ["nope"], effects: [{ type: "blur.gaussian" }] },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(store.getSnapshot().timeline).toBe(before);
    expect(store.canUndo()).toBe(false);
  });
});

// ── inspect_color ─────────────────────────────────────────────────────────────

function solidRgba(value: number, count = 16): Uint8Array {
  const buf = new Uint8Array(count * 4);
  for (let i = 0; i < count; i++) {
    buf[i * 4] = value;
    buf[i * 4 + 1] = value;
    buf[i * 4 + 2] = value;
    buf[i * 4 + 3] = 255;
  }
  return buf;
}

describe("inspect_color", () => {
  test("no renderFrame → isError with 'not available' message", async () => {
    const store = new EditorStore(makeTimeline());
    const ctx = makeCtx(store);
    const result = await inspectColorTool().run({}, ctx);
    expect(result.isError).toBe(true);
    const block = result.blocks[0];
    expect(block?.kind === "text" && block.text).toMatch(/not available/);
  });

  test("solid grey → scopes.lumaMean ≈ 128/255", async () => {
    const store = new EditorStore(makeTimeline());
    const ctx: ToolContext = {
      ...makeCtx(store),
      renderFrame: async () => ({ rgba: solidRgba(128), width: 4, height: 4 }),
    };
    const result = await inspectColorTool().run({}, ctx);
    expect(result.isError).toBe(false);
    const textBlock = result.blocks.find((b) => b.kind === "text");
    expect(textBlock).toBeDefined();
    const payload = JSON.parse((textBlock as { kind: "text"; text: string }).text) as {
      scopes: { lumaMean: number };
    };
    expect(payload.scopes.lumaMean).toBeCloseTo(128 / 255, 2);
  });

  test("referenceFrame → payload has gap with deltas + hints array", async () => {
    const store = new EditorStore(makeTimeline());
    const ctx: ToolContext = {
      ...makeCtx(store),
      renderFrame: async (f: number) => ({
        rgba: solidRgba(f === 0 ? 128 : 200),
        width: 4,
        height: 4,
      }),
    };
    const result = await inspectColorTool().run({ atFrame: 0, referenceFrame: 10 }, ctx);
    expect(result.isError).toBe(false);
    const textBlock = result.blocks.find((b) => b.kind === "text");
    const payload = JSON.parse((textBlock as { kind: "text"; text: string }).text) as {
      gap: { deltas: Record<string, unknown>; hints: string[] };
    };
    expect(payload.gap).toBeDefined();
    expect(payload.gap.deltas).toBeDefined();
    expect(Array.isArray(payload.gap.hints)).toBe(true);
    // grey 128 vs 200 differs well past the luma threshold → a real, non-empty gap
    expect((payload.gap.deltas["lumaMean"] as number)).not.toBe(0);
    expect(payload.gap.hints.length).toBeGreaterThan(0);
  });

  test("jpegBase64 present → image block returned before text block", async () => {
    const store = new EditorStore(makeTimeline());
    const ctx: ToolContext = {
      ...makeCtx(store),
      renderFrame: async () => ({
        rgba: solidRgba(128),
        width: 4,
        height: 4,
        jpegBase64: "fakejpeg==",
      }),
    };
    const result = await inspectColorTool().run({}, ctx);
    expect(result.isError).toBe(false);
    const imageBlock = result.blocks.find((b) => b.kind === "image");
    expect(imageBlock).toBeDefined();
    expect(result.blocks[0]?.kind).toBe("image"); // image precedes the text readout
    expect(result.blocks[result.blocks.length - 1]?.kind).toBe("text");
    expect((imageBlock as { kind: "image"; base64: string; mediaType: string }).base64).toBe("fakejpeg==");
    expect((imageBlock as { kind: "image"; base64: string; mediaType: string }).mediaType).toBe("image/jpeg");
  });
});
