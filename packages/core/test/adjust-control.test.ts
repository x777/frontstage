import { describe, it, expect } from "vitest";
import { sliderFrac, sliderValue, scrubDelta, formatParam } from "../src/color/adjust-control.js";

describe("adjust-control", () => {
  it("sliderFrac maps + clamps", () => {
    expect(sliderFrac(6500, 2000, 11000)).toBeCloseTo(0.5, 2);
    expect(sliderFrac(-99, -3, 3)).toBe(0);
    expect(sliderFrac(99, -3, 3)).toBe(1);
  });
  it("sliderValue is the inverse", () => {
    expect(sliderValue(0.5, -1, 1)).toBeCloseTo(0, 5);
    expect(sliderValue(0, 0, 2)).toBe(0);
    expect(sliderValue(1, 0, 2)).toBe(2);
  });
  it("scrubDelta scales with range + modifiers", () => {
    const base = scrubDelta(10, -1, 1, {});
    expect(base).toBeCloseTo((2 / 200) * 10, 5);
    expect(scrubDelta(10, -1, 1, { shift: true })).toBeCloseTo(base * 10, 5);
    expect(scrubDelta(10, -1, 1, { meta: true })).toBeCloseTo(base * 0.1, 5);
  });
  it("formatParam picks precision by range span", () => {
    expect(formatParam(1.234, -1, 1)).toBe("1.23");
    expect(formatParam(6500, 2000, 11000)).toBe("6500");
  });
});
