import { describe, it, expect } from "vitest";
import type { Clip } from "../clip.js";
import type { Track, Timeline } from "../timeline.js";
import { EditorStore } from "./editor-store.js";
import { setKeyframeCommand, removeKeyframeCommand } from "./keyframe-commands.js";
import { setClipTextStyleCommand } from "./commands.js";
import { frameAtX, frameAtXContinuous, makeGeometry } from "../timeline/geometry.js";

// --- Fixtures ---

function makeClip(overrides: Partial<Clip> & { id: string }): Clip {
  return {
    mediaRef: "asset-1",
    mediaType: "video",
    sourceClipType: "video",
    startFrame: 0,
    durationFrames: 60,
    trimStartFrame: 0,
    trimEndFrame: 0,
    speed: 1,
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    fadeInInterpolation: "linear",
    fadeOutInterpolation: "linear",
    opacity: 1,
    transform: { centerX: 0.5, centerY: 0.5, width: 1, height: 1, rotation: 0, flipHorizontal: false, flipVertical: false },
    crop: { left: 0, top: 0, right: 0, bottom: 0 },
    ...overrides,
  };
}

function makeTrack(clips: Clip[], id = "t1"): Track {
  return { id, type: "video", muted: false, hidden: false, syncLocked: false, clips };
}

function makeTimeline(clips: Clip[]): Timeline {
  return { fps: 30, width: 1920, height: 1080, settingsConfigured: true, tracks: [makeTrack(clips)] };
}

// --- setKeyframeCommand ---

describe("setKeyframeCommand — opacityTrack", () => {
  it("creates a track when absent", () => {
    const clip = makeClip({ id: "c1" });
    const tl = makeTimeline([clip]);
    const result = setKeyframeCommand("c1", "opacityTrack", 10, 0.5).apply(tl);
    const c = result.tracks[0]!.clips[0]!;
    expect(c.opacityTrack).toBeDefined();
    expect(c.opacityTrack!.keyframes).toHaveLength(1);
    expect(c.opacityTrack!.keyframes[0]!.frame).toBe(10);
    expect(c.opacityTrack!.keyframes[0]!.value).toBe(0.5);
  });

  it("upserts (replaces) at an existing frame", () => {
    const clip = makeClip({
      id: "c1",
      opacityTrack: { keyframes: [{ frame: 10, value: 0.5, interpolationOut: "linear" }] },
    });
    const tl = makeTimeline([clip]);
    const result = setKeyframeCommand("c1", "opacityTrack", 10, 0.9).apply(tl);
    const kfs = result.tracks[0]!.clips[0]!.opacityTrack!.keyframes;
    expect(kfs).toHaveLength(1);
    expect(kfs[0]!.value).toBe(0.9);
  });

  it("clamps a frame beyond the clip duration to durationFrames - 1", () => {
    const tl = makeTimeline([makeClip({ id: "c1", durationFrames: 60 })]);
    const result = setKeyframeCommand("c1", "opacityTrack", 99999, 0.5).apply(tl);
    expect(result.tracks[0]!.clips[0]!.opacityTrack!.keyframes[0]!.frame).toBe(59);
  });

  it("clamps a negative frame to 0", () => {
    const tl = makeTimeline([makeClip({ id: "c1", durationFrames: 60 })]);
    const result = setKeyframeCommand("c1", "opacityTrack", -50, 0.5).apply(tl);
    expect(result.tracks[0]!.clips[0]!.opacityTrack!.keyframes[0]!.frame).toBe(0);
  });

  it("stores frame as given (clip-relative offset)", () => {
    const clip = makeClip({ id: "c1", startFrame: 20 });
    const tl = makeTimeline([clip]);
    // caller passes playhead - clip.startFrame = 35 - 20 = 15
    const result = setKeyframeCommand("c1", "opacityTrack", 15, 0.75).apply(tl);
    const kf = result.tracks[0]!.clips[0]!.opacityTrack!.keyframes[0]!;
    expect(kf.frame).toBe(15);
  });

  it("keeps keyframes sorted when inserting at earlier frame", () => {
    const clip = makeClip({
      id: "c1",
      opacityTrack: { keyframes: [{ frame: 20, value: 1, interpolationOut: "linear" }] },
    });
    const tl = makeTimeline([clip]);
    const result = setKeyframeCommand("c1", "opacityTrack", 5, 0.3).apply(tl);
    const kfs = result.tracks[0]!.clips[0]!.opacityTrack!.keyframes;
    expect(kfs[0]!.frame).toBe(5);
    expect(kfs[1]!.frame).toBe(20);
  });

  it("no-op same ref when clip missing", () => {
    const tl = makeTimeline([]);
    const result = setKeyframeCommand("missing", "opacityTrack", 0, 1).apply(tl);
    expect(result).toBe(tl);
  });
});

describe("setKeyframeCommand — positionTrack (AnimPair)", () => {
  it("creates positionTrack with AnimPair value", () => {
    const clip = makeClip({ id: "c1" });
    const tl = makeTimeline([clip]);
    const value = { a: 0.2, b: 0.8 };
    const result = setKeyframeCommand("c1", "positionTrack", 5, value).apply(tl);
    const kf = result.tracks[0]!.clips[0]!.positionTrack!.keyframes[0]!;
    expect(kf.value).toEqual({ a: 0.2, b: 0.8 });
  });
});

describe("setKeyframeCommand — cropTrack (Crop)", () => {
  it("creates cropTrack with Crop value", () => {
    const clip = makeClip({ id: "c1" });
    const tl = makeTimeline([clip]);
    const value = { left: 0.1, top: 0.2, right: 0.1, bottom: 0.2 };
    const result = setKeyframeCommand("c1", "cropTrack", 0, value).apply(tl);
    const kf = result.tracks[0]!.clips[0]!.cropTrack!.keyframes[0]!;
    expect(kf.value).toEqual(value);
  });
});

describe("setKeyframeCommand — interpolationOut", () => {
  it("defaults to linear", () => {
    const clip = makeClip({ id: "c1" });
    const tl = makeTimeline([clip]);
    const result = setKeyframeCommand("c1", "opacityTrack", 0, 1).apply(tl);
    expect(result.tracks[0]!.clips[0]!.opacityTrack!.keyframes[0]!.interpolationOut).toBe("linear");
  });

  it("accepts hold interpolation", () => {
    const clip = makeClip({ id: "c1" });
    const tl = makeTimeline([clip]);
    const result = setKeyframeCommand("c1", "opacityTrack", 0, 1, "hold").apply(tl);
    expect(result.tracks[0]!.clips[0]!.opacityTrack!.keyframes[0]!.interpolationOut).toBe("hold");
  });
});

describe("setKeyframeCommand — undo round-trip", () => {
  it("round-trips via EditorStore.undo", () => {
    const clip = makeClip({ id: "c1" });
    const tl = makeTimeline([clip]);
    const store = new EditorStore(tl);
    const prior = store.getSnapshot().timeline;
    store.dispatch(setKeyframeCommand("c1", "opacityTrack", 10, 0.5));
    expect(store.getSnapshot().timeline).not.toBe(prior);
    store.undo();
    expect(store.getSnapshot().timeline).toBe(prior);
  });
});

// --- removeKeyframeCommand ---

describe("removeKeyframeCommand", () => {
  it("removes an existing keyframe", () => {
    const clip = makeClip({
      id: "c1",
      opacityTrack: {
        keyframes: [
          { frame: 5, value: 0.5, interpolationOut: "linear" },
          { frame: 20, value: 1, interpolationOut: "linear" },
        ],
      },
    });
    const tl = makeTimeline([clip]);
    const result = removeKeyframeCommand("c1", "opacityTrack", 5).apply(tl);
    const kfs = result.tracks[0]!.clips[0]!.opacityTrack!.keyframes;
    expect(kfs).toHaveLength(1);
    expect(kfs[0]!.frame).toBe(20);
  });

  it("sets track to undefined when last keyframe is removed", () => {
    const clip = makeClip({
      id: "c1",
      opacityTrack: { keyframes: [{ frame: 10, value: 0.5, interpolationOut: "linear" }] },
    });
    const tl = makeTimeline([clip]);
    const result = removeKeyframeCommand("c1", "opacityTrack", 10).apply(tl);
    expect(result.tracks[0]!.clips[0]!.opacityTrack).toBeUndefined();
  });

  it("no-op same ref when track absent", () => {
    const clip = makeClip({ id: "c1" });
    const tl = makeTimeline([clip]);
    const result = removeKeyframeCommand("c1", "opacityTrack", 10).apply(tl);
    expect(result).toBe(tl);
  });

  it("no-op same ref when no keyframe at given frame", () => {
    const clip = makeClip({
      id: "c1",
      opacityTrack: { keyframes: [{ frame: 5, value: 0.5, interpolationOut: "linear" }] },
    });
    const tl = makeTimeline([clip]);
    const result = removeKeyframeCommand("c1", "opacityTrack", 99).apply(tl);
    expect(result).toBe(tl);
  });

  it("no-op same ref when clip missing", () => {
    const tl = makeTimeline([]);
    const result = removeKeyframeCommand("missing", "opacityTrack", 0).apply(tl);
    expect(result).toBe(tl);
  });

  it("undo round-trip via EditorStore", () => {
    const clip = makeClip({
      id: "c1",
      opacityTrack: { keyframes: [{ frame: 10, value: 0.5, interpolationOut: "linear" }] },
    });
    const tl = makeTimeline([clip]);
    const store = new EditorStore(tl);
    const prior = store.getSnapshot().timeline;
    store.dispatch(removeKeyframeCommand("c1", "opacityTrack", 10));
    expect(store.getSnapshot().timeline).not.toBe(prior);
    store.undo();
    expect(store.getSnapshot().timeline).toBe(prior);
  });
});

// --- setClipTextStyleCommand ---

describe("setClipTextStyleCommand", () => {
  it("replaces textStyle on clip", () => {
    const clip = makeClip({ id: "c1" });
    const tl = makeTimeline([clip]);
    const style = {
      fontName: "Helvetica",
      fontSize: 48,
      fontScale: 1,
      color: { r: 1, g: 0, b: 0, a: 1 },
      alignment: "left" as const,
      shadow: { enabled: false, color: { r: 0, g: 0, b: 0, a: 1 }, offsetX: 0, offsetY: 0, blur: 0 },
      background: { enabled: false, color: { r: 0, g: 0, b: 0, a: 1 } },
      border: { enabled: false, color: { r: 0, g: 0, b: 0, a: 1 } },
    };
    const result = setClipTextStyleCommand("c1", style).apply(tl);
    expect(result.tracks[0]!.clips[0]!.textStyle).toEqual(style);
  });

  it("no-op same ref when clip missing", () => {
    const tl = makeTimeline([]);
    const style = {
      fontName: "Helvetica",
      fontSize: 48,
      fontScale: 1,
      color: { r: 1, g: 1, b: 1, a: 1 },
      alignment: "center" as const,
      shadow: { enabled: false, color: { r: 0, g: 0, b: 0, a: 1 }, offsetX: 0, offsetY: 0, blur: 0 },
      background: { enabled: false, color: { r: 0, g: 0, b: 0, a: 1 } },
      border: { enabled: false, color: { r: 0, g: 0, b: 0, a: 1 } },
    };
    const result = setClipTextStyleCommand("missing", style).apply(tl);
    expect(result).toBe(tl);
  });

  it("undo round-trip via EditorStore", () => {
    const clip = makeClip({ id: "c1" });
    const tl = makeTimeline([clip]);
    const store = new EditorStore(tl);
    const prior = store.getSnapshot().timeline;
    const style = {
      fontName: "Helvetica",
      fontSize: 48,
      fontScale: 1,
      color: { r: 1, g: 1, b: 1, a: 1 },
      alignment: "center" as const,
      shadow: { enabled: false, color: { r: 0, g: 0, b: 0, a: 1 }, offsetX: 0, offsetY: 0, blur: 0 },
      background: { enabled: false, color: { r: 0, g: 0, b: 0, a: 1 } },
      border: { enabled: false, color: { r: 0, g: 0, b: 0, a: 1 } },
    };
    store.dispatch(setClipTextStyleCommand("c1", style));
    expect(store.getSnapshot().timeline).not.toBe(prior);
    store.undo();
    expect(store.getSnapshot().timeline).toBe(prior);
  });
});

// --- frameAtXContinuous ---

describe("frameAtXContinuous", () => {
  it("returns a fractional (non-rounded) frame", () => {
    const g = makeGeometry({ pixelsPerFrame: 10 });
    // x=15 → (15 - 0 + 0) / 10 = 1.5
    expect(frameAtXContinuous(g, 15)).toBe(1.5);
  });

  it("accounts for headerWidth and scrollX", () => {
    const g = makeGeometry({ pixelsPerFrame: 4, headerWidth: 100, scrollX: 20 });
    // x=140 → (140 - 100 + 20) / 4 = 60/4 = 15
    expect(frameAtXContinuous(g, 140)).toBe(15);
  });

  it("returns negative for x before visible area (no clamping)", () => {
    const g = makeGeometry({ pixelsPerFrame: 10, scrollX: 0 });
    expect(frameAtXContinuous(g, -10)).toBe(-1);
  });

  it("frameAtX equals Math.round(frameAtXContinuous) for representative x", () => {
    const g = makeGeometry({ pixelsPerFrame: 10, scrollX: 30, headerWidth: 50 });
    const xs = [50, 55, 58, 63, 100, 200];
    for (const x of xs) {
      const continuous = frameAtXContinuous(g, x);
      const rounded = frameAtX(g, x);
      expect(rounded).toBe(Math.max(0, Math.round(continuous)));
    }
  });

  it("result is continuous between pixels", () => {
    const g = makeGeometry({ pixelsPerFrame: 8 });
    const f1 = frameAtXContinuous(g, 4);
    const f2 = frameAtXContinuous(g, 8);
    expect(f2 - f1).toBeCloseTo(0.5);
  });
});
