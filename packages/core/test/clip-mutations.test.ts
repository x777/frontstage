import { describe, expect, test } from "vitest";
import type { Clip } from "../src/clip.js";
import { clampKeyframesToDuration, setDuration, setFade } from "../src/clip-mutations.js";
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

describe("clip mutations", () => {
  test("setFade clamps so head+tail cannot exceed duration", () => {
    const c = setFade(setFade(base({ durationFrames: 30 }), "left", 20), "right", 20);
    expect(c.fadeInFrames).toBe(20);
    expect(c.fadeOutFrames).toBe(10);
  });
  test("does not mutate input", () => {
    const c = base();
    setFade(c, "left", 5);
    expect(c.fadeInFrames).toBe(0);
  });
  test("setDuration clamps keyframes past the new end", () => {
    const c = base({
      durationFrames: 100,
      opacityTrack: { keyframes: [
        { frame: 0, value: 1, interpolationOut: "linear" },
        { frame: 80, value: 0, interpolationOut: "linear" },
      ] },
    });
    const shrunk = setDuration(c, 50);
    expect(shrunk.opacityTrack?.keyframes.map((k) => k.frame)).toEqual([0]);
  });
  test("clampKeyframesToDuration drops out-of-range and nils empty tracks", () => {
    const c = base({
      durationFrames: 10,
      rotationTrack: { keyframes: [{ frame: 99, value: 1, interpolationOut: "linear" }] },
    });
    expect(clampKeyframesToDuration(c).rotationTrack).toBeUndefined();
  });
});
