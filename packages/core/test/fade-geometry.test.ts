import { describe, expect, test } from "vitest";
import {
  fadeFramesFromCursor,
  fadeHandleRenderX,
  fadeKneeHit,
  setFade,
  setFadeCommand,
  EditorStore,
  defaultTimeline,
  defaultTransform,
  defaultCrop,
  type Clip,
} from "../src/index.js";

function clip(over: Partial<Clip> = {}): Clip {
  return {
    id: "c1",
    mediaRef: "m",
    mediaType: "audio",
    sourceClipType: "audio",
    startFrame: 10,
    durationFrames: 40,
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

describe("fadeHandleRenderX", () => {
  test("clamps the knee inside the edge inset", () => {
    const x0 = fadeHandleRenderX(0, 100, 0, 2);
    const xEnd = fadeHandleRenderX(0, 100, 50, 2);
    expect(x0).toBeGreaterThan(0);
    expect(xEnd).toBeLessThan(100);
    expect(fadeHandleRenderX(0, 100, 10, 2)).toBe(20);
  });
});

describe("fadeFramesFromCursor", () => {
  test("left knee: frames = cursor - start, clamped so in+out fit duration", () => {
    const c = clip({ fadeOutFrames: 10 });
    expect(fadeFramesFromCursor(c, "left", 10)).toBe(0);
    expect(fadeFramesFromCursor(c, "left", 25)).toBe(15);
    expect(fadeFramesFromCursor(c, "left", 100)).toBe(30); // cap duration-out = 30
  });

  test("right knee: frames = end - cursor", () => {
    const c = clip({ fadeInFrames: 5 });
    expect(fadeFramesFromCursor(c, "right", 50)).toBe(0);
    expect(fadeFramesFromCursor(c, "right", 40)).toBe(10);
    expect(fadeFramesFromCursor(c, "right", 0)).toBe(35); // cap duration-in = 35
  });
});

describe("fadeKneeHit", () => {
  test("hits the left knee near the fade handle, not the clip interior", () => {
    const c = clip({ fadeInFrames: 10, startFrame: 0, durationFrames: 40 });
    const rect = { x: 0, y: 0, width: 80, height: 50 }; // 2 px/frame
    const left = fadeKneeHit(c, rect, fadeHandleRenderX(0, 80, 10, 2), 16 + 4);
    expect(left).toBe("left");
    expect(fadeKneeHit(c, rect, 40, 40)).toBeNull();
  });
});

describe("setFadeCommand", () => {
  test("clamps so head+tail cannot exceed duration; one coalesce key is one undo", () => {
    const tl = {
      ...defaultTimeline(),
      tracks: [
        {
          id: "a",
          type: "audio" as const,
          muted: false,
          hidden: false,
          syncLocked: false,
          clips: [clip({ durationFrames: 30, startFrame: 0 })],
        },
      ],
    };
    const store = new EditorStore(tl);
    store.dispatch(setFadeCommand("c1", "left", 20, "fade-c1"));
    store.dispatch(setFadeCommand("c1", "right", 20, "fade-c1"));
    const c = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
    expect(c.fadeInFrames + c.fadeOutFrames).toBeLessThanOrEqual(30);
    store.undo();
    expect(store.getSnapshot().timeline.tracks[0]!.clips[0]!.fadeInFrames).toBe(0);
  });
});

describe("setFade", () => {
  test("zero clears a fade", () => {
    const c = setFade(clip({ fadeInFrames: 12 }), "left", 0);
    expect(c.fadeInFrames).toBe(0);
  });
});
