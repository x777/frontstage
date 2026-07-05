import { describe, expect, test } from "vitest";
import {
  EditorStore,
  defaultTimeline,
  defaultTransform,
  defaultCrop,
  findClip,
  type Timeline,
  type Track,
} from "@palmier/core";
import {
  setClipPropertiesTool,
  setKeyframesTool,
  addTextsTool,
  type ToolContext,
} from "../src/index.js";

// ── fixtures ────────────────────────────────────────────────────────────────

function makeClip(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    mediaRef: "media-1",
    mediaType: "video" as const,
    sourceClipType: "video" as const,
    startFrame: 0,
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
    ...extra,
  };
}

function makeTrack(id = "t1", clips = [makeClip("c1")]): Track {
  return { id, type: "video", muted: false, hidden: false, syncLocked: false, clips };
}

function makeTimeline(): Timeline {
  return { ...defaultTimeline(), tracks: [makeTrack()] };
}

let _idCounter = 0;
function makeCtx(store: EditorStore): ToolContext {
  return {
    store,
    getManifest: () => ({ version: 2, entries: [], folders: [] }),
    newId: () => `gen-${++_idCounter}`,
  };
}

function getClip(store: EditorStore, id: string) {
  const tl = store.getSnapshot().timeline;
  const loc = findClip(tl, id)!;
  return tl.tracks[loc.trackIndex]!.clips[loc.clipIndex]!;
}

// ── set_clip_properties ────────────────────────────────────────────────────

describe("set_clip_properties", () => {
  test("sets opacity scalar", async () => {
    const store = new EditorStore(makeTimeline());
    const ctx = makeCtx(store);
    const spec = setClipPropertiesTool();
    const result = await spec.run({ clipId: "c1", properties: { opacity: 0.5 } }, ctx);
    expect(result.isError).toBe(false);
    expect(getClip(store, "c1").opacity).toBe(0.5);
  });

  test("sets volume scalar", async () => {
    const store = new EditorStore(makeTimeline());
    const ctx = makeCtx(store);
    const result = await setClipPropertiesTool().run({ clipId: "c1", properties: { volume: 0.25 } }, ctx);
    expect(result.isError).toBe(false);
    expect(getClip(store, "c1").volume).toBe(0.25);
  });

  test("sets speed scalar", async () => {
    const store = new EditorStore(makeTimeline());
    const ctx = makeCtx(store);
    const result = await setClipPropertiesTool().run({ clipId: "c1", properties: { speed: 2 } }, ctx);
    expect(result.isError).toBe(false);
    expect(getClip(store, "c1").speed).toBe(2);
  });

  test("sets transform", async () => {
    const store = new EditorStore(makeTimeline());
    const ctx = makeCtx(store);
    const newTransform = { centerX: 0.3, centerY: 0.7, width: 0.5, height: 0.5, rotation: 45, flipHorizontal: false, flipVertical: true };
    const result = await setClipPropertiesTool().run({ clipId: "c1", properties: { transform: newTransform } }, ctx);
    expect(result.isError).toBe(false);
    expect(getClip(store, "c1").transform).toEqual(newTransform);
  });

  test("sets crop", async () => {
    const store = new EditorStore(makeTimeline());
    const ctx = makeCtx(store);
    const newCrop = { top: 0.1, bottom: 0.1, left: 0.05, right: 0.05 };
    const result = await setClipPropertiesTool().run({ clipId: "c1", properties: { crop: newCrop } }, ctx);
    expect(result.isError).toBe(false);
    expect(getClip(store, "c1").crop).toEqual(newCrop);
  });

  test("sets textStyle", async () => {
    const store = new EditorStore(makeTimeline());
    const ctx = makeCtx(store);
    const style = {
      fontName: "Arial-Bold",
      fontSize: 72,
      fontScale: 1,
      color: { r: 1, g: 0, b: 0, a: 1 },
      alignment: "left" as const,
      shadow: { enabled: false, color: { r: 0, g: 0, b: 0, a: 0.6 }, offsetX: 0, offsetY: 0, blur: 0 },
      background: { enabled: false, color: { r: 0, g: 0, b: 0, a: 0.6 } },
      border: { enabled: false, color: { r: 0, g: 0, b: 0, a: 1 } },
    };
    const result = await setClipPropertiesTool().run({ clipId: "c1", properties: { textStyle: style } }, ctx);
    expect(result.isError).toBe(false);
    expect(getClip(store, "c1").textStyle).toEqual(style);
  });

  test("multiple properties in one call = ONE undo step", async () => {
    const store = new EditorStore(makeTimeline());
    const ctx = makeCtx(store);
    await setClipPropertiesTool().run({ clipId: "c1", properties: { opacity: 0.5, volume: 0.8, speed: 1.5 } }, ctx);
    expect(store.canUndo()).toBe(true);
    store.undo();
    const clip = getClip(store, "c1");
    expect(clip.opacity).toBe(1);
    expect(clip.volume).toBe(1);
    expect(clip.speed).toBe(1);
    expect(store.canUndo()).toBe(false);
  });

  test("unknown clipId returns isError:true, store unchanged", async () => {
    const store = new EditorStore(makeTimeline());
    const before = store.getSnapshot().timeline;
    const ctx = makeCtx(store);
    const result = await setClipPropertiesTool().run({ clipId: "nope", properties: { opacity: 0.5 } }, ctx);
    expect(result.isError).toBe(true);
    expect(store.getSnapshot().timeline).toBe(before);
    expect(store.canUndo()).toBe(false);
  });
});

// ── set_keyframes ──────────────────────────────────────────────────────────

describe("set_keyframes", () => {
  test("adds opacity keyframes", async () => {
    const store = new EditorStore(makeTimeline());
    const ctx = makeCtx(store);
    const result = await setKeyframesTool().run({
      clipId: "c1",
      trackKey: "opacityTrack",
      keyframes: [{ frame: 0, value: 0 }, { frame: 30, value: 1 }],
    }, ctx);
    expect(result.isError).toBe(false);
    const clip = getClip(store, "c1");
    expect(clip.opacityTrack?.keyframes).toHaveLength(2);
  });

  test("adds position keyframes with AnimPair value", async () => {
    const store = new EditorStore(makeTimeline());
    const ctx = makeCtx(store);
    const result = await setKeyframesTool().run({
      clipId: "c1",
      trackKey: "positionTrack",
      keyframes: [{ frame: 0, value: { a: 0.1, b: 0.2 } }],
    }, ctx);
    expect(result.isError).toBe(false);
    const clip = getClip(store, "c1");
    expect(clip.positionTrack?.keyframes).toHaveLength(1);
    expect(clip.positionTrack?.keyframes[0]?.value).toEqual({ a: 0.1, b: 0.2 });
  });

  test("remove:true uses removeKeyframeCommand", async () => {
    const store = new EditorStore(makeTimeline());
    const ctx = makeCtx(store);
    // First add a keyframe
    await setKeyframesTool().run({
      clipId: "c1",
      trackKey: "opacityTrack",
      keyframes: [{ frame: 0, value: 0.5 }],
    }, ctx);
    // Then remove it
    const result = await setKeyframesTool().run({
      clipId: "c1",
      trackKey: "opacityTrack",
      keyframes: [{ frame: 0, value: null, remove: true }],
    }, ctx);
    expect(result.isError).toBe(false);
    const clip = getClip(store, "c1");
    expect(clip.opacityTrack).toBeUndefined();
  });

  test("multiple keyframes in one call = ONE undo step", async () => {
    const store = new EditorStore(makeTimeline());
    const ctx = makeCtx(store);
    await setKeyframesTool().run({
      clipId: "c1",
      trackKey: "volumeTrack",
      keyframes: [{ frame: 0, value: 0 }, { frame: 30, value: 6 }, { frame: 60, value: 0 }],
    }, ctx);
    expect(store.canUndo()).toBe(true);
    store.undo();
    const clip = getClip(store, "c1");
    expect(clip.volumeTrack).toBeUndefined();
    expect(store.canUndo()).toBe(false);
  });

  test("unknown clipId returns isError:true, store unchanged", async () => {
    const store = new EditorStore(makeTimeline());
    const before = store.getSnapshot().timeline;
    const ctx = makeCtx(store);
    const result = await setKeyframesTool().run({
      clipId: "nope",
      trackKey: "opacityTrack",
      keyframes: [{ frame: 0, value: 1 }],
    }, ctx);
    expect(result.isError).toBe(true);
    expect(store.getSnapshot().timeline).toBe(before);
    expect(store.canUndo()).toBe(false);
  });

  test("wrong-shaped value for opacityTrack (AnimPair) returns isError, store unchanged", async () => {
    const store = new EditorStore(makeTimeline());
    const before = store.getSnapshot().timeline;
    const ctx = makeCtx(store);
    const result = await setKeyframesTool().run({
      clipId: "c1",
      trackKey: "opacityTrack",
      keyframes: [{ frame: 0, value: { a: 0.5, b: 0.5 } }],
    }, ctx);
    expect(result.isError).toBe(true);
    expect(store.getSnapshot().timeline).toBe(before);
    expect(store.canUndo()).toBe(false);
  });

  test("wrong-shaped value for positionTrack (number) returns isError, store unchanged", async () => {
    const store = new EditorStore(makeTimeline());
    const before = store.getSnapshot().timeline;
    const ctx = makeCtx(store);
    const result = await setKeyframesTool().run({
      clipId: "c1",
      trackKey: "positionTrack",
      keyframes: [{ frame: 0, value: 0.5 }],
    }, ctx);
    expect(result.isError).toBe(true);
    expect(store.getSnapshot().timeline).toBe(before);
    expect(store.canUndo()).toBe(false);
  });

  test("wrong-shaped value for cropTrack (number) returns isError, store unchanged", async () => {
    const store = new EditorStore(makeTimeline());
    const before = store.getSnapshot().timeline;
    const ctx = makeCtx(store);
    const result = await setKeyframesTool().run({
      clipId: "c1",
      trackKey: "cropTrack",
      keyframes: [{ frame: 0, value: 0.5 }],
    }, ctx);
    expect(result.isError).toBe(true);
    expect(store.getSnapshot().timeline).toBe(before);
    expect(store.canUndo()).toBe(false);
  });

  test("correct crop shape for cropTrack succeeds", async () => {
    const store = new EditorStore(makeTimeline());
    const ctx = makeCtx(store);
    const result = await setKeyframesTool().run({
      clipId: "c1",
      trackKey: "cropTrack",
      keyframes: [{ frame: 0, value: { left: 0.1, top: 0.1, right: 0.1, bottom: 0.1 } }],
    }, ctx);
    expect(result.isError).toBe(false);
    const clip = getClip(store, "c1");
    expect(clip.cropTrack?.keyframes).toHaveLength(1);
  });
});

// ── add_texts ─────────────────────────────────────────────────────────────

describe("add_texts", () => {
  test("creates a text clip with content", async () => {
    const store = new EditorStore({ ...defaultTimeline() });
    const ctx = makeCtx(store);
    const result = await addTextsTool().run({
      texts: [{ content: "Hello World", startFrame: 0, durationFrames: 90 }],
    }, ctx);
    expect(result.isError).toBe(false);
    const tl = store.getSnapshot().timeline;
    expect(tl.tracks).toHaveLength(1);
    const clip = tl.tracks[0]!.clips[0]!;
    expect(clip.mediaType).toBe("text");
    expect(clip.textContent).toBe("Hello World");
  });

  test("new-track text mints a distinct track id (no clip/track collision)", async () => {
    const store = new EditorStore({ ...defaultTimeline() });
    const ctx = makeCtx(store);
    const result = await addTextsTool().run({
      texts: [{ content: "Solo", startFrame: 0, durationFrames: 30 }],
    }, ctx);
    expect(result.isError).toBe(false);
    const tl = store.getSnapshot().timeline;
    const track = tl.tracks[0]!;
    const clip = track.clips[0]!;
    expect(track.id).not.toBe(clip.id);
  });

  test("text clip has style when provided", async () => {
    const store = new EditorStore({ ...defaultTimeline() });
    const ctx = makeCtx(store);
    const style = {
      fontName: "Helvetica-Bold",
      fontSize: 48,
      fontScale: 1,
      color: { r: 0, g: 1, b: 0, a: 1 },
      alignment: "center" as const,
      shadow: { enabled: false, color: { r: 0, g: 0, b: 0, a: 0.6 }, offsetX: 0, offsetY: 0, blur: 0 },
      background: { enabled: false, color: { r: 0, g: 0, b: 0, a: 0.6 } },
      border: { enabled: false, color: { r: 0, g: 0, b: 0, a: 1 } },
    };
    await addTextsTool().run({
      texts: [{ content: "Styled", startFrame: 0, style }],
    }, ctx);
    const clip = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
    expect(clip.textStyle).toEqual(style);
  });

  test("multiple text clips = ONE undo step", async () => {
    const store = new EditorStore({ ...defaultTimeline() });
    const ctx = makeCtx(store);
    await addTextsTool().run({
      texts: [
        { content: "A", startFrame: 0 },
        { content: "B", startFrame: 100 },
      ],
    }, ctx);
    expect(store.canUndo()).toBe(true);
    store.undo();
    expect(store.getSnapshot().timeline.tracks).toHaveLength(0);
    expect(store.canUndo()).toBe(false);
  });

  test("uses trackIndex when provided", async () => {
    // Start with an existing text track
    const textTrack: Track = { id: "txt-track", type: "text", muted: false, hidden: false, syncLocked: false, clips: [] };
    const store = new EditorStore({ ...defaultTimeline(), tracks: [textTrack] });
    const ctx = makeCtx(store);
    await addTextsTool().run({
      texts: [{ content: "On existing", startFrame: 10, trackIndex: 0 }],
    }, ctx);
    const tl = store.getSnapshot().timeline;
    expect(tl.tracks[0]!.clips).toHaveLength(1);
  });

  test("incompatible trackIndex (audio track) returns isError, store unchanged", async () => {
    const audioTrack: Track = { id: "at1", type: "audio", muted: false, hidden: false, syncLocked: false, clips: [] };
    const store = new EditorStore({ ...defaultTimeline(), tracks: [audioTrack] });
    const before = store.getSnapshot().timeline;
    const ctx = makeCtx(store);
    const result = await addTextsTool().run({
      texts: [{ content: "Won't fit", startFrame: 0, trackIndex: 0 }],
    }, ctx);
    expect(result.isError).toBe(true);
    expect(store.getSnapshot().timeline).toBe(before);
    expect(store.canUndo()).toBe(false);
  });

  test("out-of-range trackIndex returns isError, store unchanged", async () => {
    const store = new EditorStore({ ...defaultTimeline() }); // no tracks
    const before = store.getSnapshot().timeline;
    const ctx = makeCtx(store);
    const result = await addTextsTool().run({
      texts: [{ content: "No track", startFrame: 0, trackIndex: 5 }],
    }, ctx);
    expect(result.isError).toBe(true);
    expect(store.getSnapshot().timeline).toBe(before);
    expect(store.canUndo()).toBe(false);
  });

  test("text clip has textAnimation when an animation preset is provided", async () => {
    const store = new EditorStore({ ...defaultTimeline() });
    const ctx = makeCtx(store);
    await addTextsTool().run({
      texts: [{ content: "Animated", startFrame: 0, animation: { preset: "popIn" } }],
    }, ctx);
    const clip = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
    expect(clip.textAnimation).toEqual({ preset: "popIn" });
    expect(clip.wordTimings).toBeUndefined();
  });

  test("text clip's textAnimation carries an optional highlightColor", async () => {
    const store = new EditorStore({ ...defaultTimeline() });
    const ctx = makeCtx(store);
    await addTextsTool().run({
      texts: [{
        content: "Highlighted",
        startFrame: 0,
        animation: { preset: "highlightPop", highlightColor: { r: 1, g: 0, b: 0, a: 1 } },
      }],
    }, ctx);
    const clip = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
    expect(clip.textAnimation).toEqual({ preset: "highlightPop", highlightColor: { r: 1, g: 0, b: 0, a: 1 } });
  });

  test("omitting animation leaves textAnimation unset", async () => {
    const store = new EditorStore({ ...defaultTimeline() });
    const ctx = makeCtx(store);
    await addTextsTool().run({
      texts: [{ content: "Plain", startFrame: 0 }],
    }, ctx);
    const clip = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
    expect(clip.textAnimation).toBeUndefined();
  });
});
