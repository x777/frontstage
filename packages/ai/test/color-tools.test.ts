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
import { applyColorTool, applyEffectTool, type ToolContext } from "../src/index.js";

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
    // neutral stack = empty → stored as undefined or empty; either is valid
    expect(clip.effects?.length ?? 0).toBe(0);
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
    expect(clip.effects?.some((e) => e.type === "blur.gaussian")).toBeFalsy();
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
    expect(clip.effects?.some((e) => e.type === "blur.gaussian")).toBeFalsy();
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
