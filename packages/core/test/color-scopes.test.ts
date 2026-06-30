import { describe, it, expect } from "vitest";
import { computeScopes } from "../src/color/scopes.js";

function fill(w: number, h: number, r: number, g: number, b: number): Uint8Array {
  const a = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { a[i * 4] = r; a[i * 4 + 1] = g; a[i * 4 + 2] = b; a[i * 4 + 3] = 255; }
  return a;
}

describe("computeScopes", () => {
  it("all-black frame: lumaMean 0, clipLow 1", () => {
    const s = computeScopes(fill(8, 8, 0, 0, 0), 8, 8);
    expect(s.lumaMean).toBeCloseTo(0, 3);
    expect(s.clipLow).toBeCloseTo(1, 3);
    expect(s.lumaHistogram).toHaveLength(16);
    expect(s.hueHistogram).toHaveLength(12);
  });
  it("all-white frame: lumaMean ~1, clipHigh 1", () => {
    const s = computeScopes(fill(8, 8, 255, 255, 255), 8, 8);
    expect(s.lumaMean).toBeCloseTo(1, 2);
    expect(s.clipHigh).toBeCloseTo(1, 3);
  });
  it("mid grey: lumaMean ~0.5, low saturation", () => {
    const s = computeScopes(fill(8, 8, 128, 128, 128), 8, 8);
    expect(s.lumaMean).toBeCloseTo(0.502, 2);
    expect(s.saturationMean).toBeCloseTo(0, 3);
  });
  it("pure red: warmCoolBias positive", () => {
    const s = computeScopes(fill(8, 8, 255, 0, 0), 8, 8);
    expect(s.warmCoolBias).toBeGreaterThan(0.5);
  });
});
