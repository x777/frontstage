import { describe, expect, it } from "vitest";
import { qualityResolution } from "../src/project-settings-presets.js";

describe("qualityResolution", () => {
  it("truncates like Swift Int(Double), not rounds (1000x700 @ 1080p -> 1542, not 1543)", () => {
    expect(qualityResolution(1080, 1000, 700)).toEqual({ width: 1542, height: 1080 });
  });

  it("portrait keeps the short edge as width", () => {
    expect(qualityResolution(1080, 700, 1000)).toEqual({ width: 1080, height: 1542 });
  });

  it("exact ratios stay exact", () => {
    expect(qualityResolution(1080, 1920, 1080)).toEqual({ width: 1920, height: 1080 });
  });
});
