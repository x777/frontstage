import { describe, expect, it } from "vitest";
import { fitLongestEdge, fitShortestSide } from "./frame-fit.js";

describe("fitLongestEdge", () => {
  it("never upscales — smaller-than-cap sizes pass through unchanged", () => {
    expect(fitLongestEdge(320, 240, 512)).toEqual({ width: 320, height: 240 });
    expect(fitLongestEdge(512, 512, 512)).toEqual({ width: 512, height: 512 });
  });

  it("downscales the longest edge to the cap, preserving aspect (landscape)", () => {
    expect(fitLongestEdge(1920, 1080, 512)).toEqual({ width: 512, height: 288 });
  });

  it("downscales the longest edge to the cap, preserving aspect (portrait)", () => {
    expect(fitLongestEdge(1080, 1920, 512)).toEqual({ width: 288, height: 512 });
  });

  it("rounds the scaled dimension", () => {
    // 1000x700 at longestEdge 512: scale = 0.512, height = 358.4 -> rounds to 358
    expect(fitLongestEdge(1000, 700, 512)).toEqual({ width: 512, height: 358 });
  });
});

describe("fitShortestSide", () => {
  it("never upscales — a shorter-than-target short side passes through unchanged (even-rounded)", () => {
    expect(fitShortestSide(320, 240, 512)).toEqual({ width: 320, height: 240 });
  });

  it("downscales the SHORT side to the target, preserving aspect (portrait 1080x1920 -> shortSide 360)", () => {
    // scale = 360/1080 = 1/3 -> 360x640
    expect(fitShortestSide(1080, 1920, 360)).toEqual({ width: 360, height: 640 });
  });

  it("downscales the short side to the target, preserving aspect (landscape 1920x1080 -> shortSide 360)", () => {
    expect(fitShortestSide(1920, 1080, 360)).toEqual({ width: 640, height: 360 });
  });

  it("even-rounds each dimension, minimum 2", () => {
    // 1000x700 at shortSide 360: scale = 360/700 -> width = 514.28 -> even-rounds to 514
    const { width, height } = fitShortestSide(1000, 700, 360);
    expect(width % 2).toBe(0);
    expect(height).toBe(360);
    expect(width).toBe(514);
  });
});
