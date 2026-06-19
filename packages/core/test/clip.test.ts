import { describe, expect, test } from "vitest";
import type { Clip } from "../src/clip.js";
import {
  clipEndFrame, fadeMultiplier, opacityAt, sizeAt, sourceFramesConsumed, transformAt, volumeAt,
} from "../src/clip.js";
import { defaultCrop, defaultTransform } from "../src/transform.js";

function base(over: Partial<Clip> = {}): Clip {
  return {
    id: "c", mediaRef: "m", mediaType: "video", sourceClipType: "video",
    startFrame: 0, durationFrames: 100, trimStartFrame: 0, trimEndFrame: 0,
    speed: 1, volume: 1, fadeInFrames: 0, fadeOutFrames: 0,
    fadeInInterpolation: "linear", fadeOutInterpolation: "linear",
    opacity: 1, transform: defaultTransform(), crop: defaultCrop(), ...over,
  };
}

describe("clip sampling", () => {
  test("endFrame and sourceFramesConsumed respect speed", () => {
    expect(clipEndFrame(base({ startFrame: 10, durationFrames: 20 }))).toBe(30);
    expect(sourceFramesConsumed(base({ durationFrames: 20, speed: 2 }))).toBe(40);
  });
  test("fade in ramps linearly from 0", () => {
    const c = base({ fadeInFrames: 10 });
    expect(fadeMultiplier(c, 0)).toBe(0);
    expect(fadeMultiplier(c, 5)).toBeCloseTo(0.5);
    expect(fadeMultiplier(c, 50)).toBe(1);
  });
  test("opacityAt folds fade for non-audio", () => {
    expect(opacityAt(base({ fadeInFrames: 10, opacity: 1 }), 5)).toBeCloseTo(0.5);
  });
  test("audio clip ignores fade in opacityAt", () => {
    expect(opacityAt(base({ mediaType: "audio", fadeInFrames: 10 }), 5)).toBe(1);
  });
  test("volumeAt applies static volume and fade", () => {
    expect(volumeAt(base({ volume: 0.5, fadeInFrames: 10 }), 5)).toBeCloseTo(0.25);
  });
  test("scaleTrack drives sizeAt", () => {
    const c = base({
      transform: { ...defaultTransform(), width: 1, height: 1 },
      scaleTrack: { keyframes: [
        { frame: 0, value: { a: 0.5, b: 0.5 }, interpolationOut: "linear" },
        { frame: 10, value: { a: 1, b: 1 }, interpolationOut: "linear" },
      ] },
    });
    expect(sizeAt(c, 5).width).toBeCloseTo(0.75);
    expect(transformAt(c, 5).width).toBeCloseTo(0.75);
  });
});
