import { describe, it, expect } from "vitest";
import { rangeLength, normalizeRange, isValidRange, rangeContains } from "./ripple-types.js";

describe("ripple-types", () => {
  it("rangeLength is end - start (half-open)", () => {
    expect(rangeLength({ start: 10, end: 25 })).toBe(15);
    expect(rangeLength({ start: 5, end: 5 })).toBe(0);
  });

  it("normalizeRange swaps an inverted range", () => {
    expect(normalizeRange({ startFrame: 30, endFrame: 10 })).toEqual({ startFrame: 10, endFrame: 30 });
    expect(normalizeRange({ startFrame: 10, endFrame: 30 })).toEqual({ startFrame: 10, endFrame: 30 });
  });

  it("isValidRange is true only when normalized end > start", () => {
    expect(isValidRange({ startFrame: 10, endFrame: 30 })).toBe(true);
    expect(isValidRange({ startFrame: 30, endFrame: 10 })).toBe(true); // normalizes to valid
    expect(isValidRange({ startFrame: 10, endFrame: 10 })).toBe(false);
  });

  it("rangeContains uses half-open bounds on the normalized range", () => {
    const r = { startFrame: 10, endFrame: 20 };
    expect(rangeContains(r, 10)).toBe(true);
    expect(rangeContains(r, 19)).toBe(true);
    expect(rangeContains(r, 20)).toBe(false); // end exclusive
    expect(rangeContains(r, 9)).toBe(false);
    expect(rangeContains({ startFrame: 20, endFrame: 10 }, 15)).toBe(true); // inverted input
  });
});
