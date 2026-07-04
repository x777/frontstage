import { describe, expect, it } from "vitest";
import { fitLongestEdge } from "./frame-fit.js";

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
