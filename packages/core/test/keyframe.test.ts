import { describe, expect, test } from "vitest";
import {
  type KeyframeTrack,
  lerpNumber,
  sampleTrack,
  smoothstep,
  upsertKeyframe,
} from "../src/keyframe.js";

const track = (frames: [number, number][], interp: "linear" | "hold" | "smooth" = "linear"): KeyframeTrack<number> => ({
  keyframes: frames.map(([frame, value]) => ({ frame, value, interpolationOut: interp })),
});

describe("keyframe sampling", () => {
  test("empty track returns fallback", () => {
    expect(sampleTrack({ keyframes: [] }, 5, 0.5, lerpNumber)).toBe(0.5);
  });
  test("clamps before first and after last", () => {
    const t = track([[10, 1], [20, 3]]);
    expect(sampleTrack(t, 0, 0, lerpNumber)).toBe(1);
    expect(sampleTrack(t, 99, 0, lerpNumber)).toBe(3);
  });
  test("linear interpolates", () => {
    expect(sampleTrack(track([[0, 0], [10, 10]]), 5, 0, lerpNumber)).toBe(5);
  });
  test("hold keeps left value", () => {
    expect(sampleTrack(track([[0, 0], [10, 10]], "hold"), 5, 0, lerpNumber)).toBe(0);
  });
  test("smooth uses smoothstep", () => {
    expect(sampleTrack(track([[0, 0], [10, 10]], "smooth"), 5, 0, lerpNumber)).toBe(smoothstep(0.5) * 10);
  });
  test("upsert replaces same frame and keeps sorted order", () => {
    let t: KeyframeTrack<number> = { keyframes: [] };
    t = upsertKeyframe(t, { frame: 10, value: 1, interpolationOut: "linear" });
    t = upsertKeyframe(t, { frame: 5, value: 2, interpolationOut: "linear" });
    t = upsertKeyframe(t, { frame: 10, value: 9, interpolationOut: "linear" });
    expect(t.keyframes.map((k) => [k.frame, k.value])).toEqual([[5, 2], [10, 9]]);
  });
});
