import { describe, it, expect } from "vitest";
import { hueDisplayPoints, evalHuePolyline, isNeutralHueCurve } from "../src/color/hue-curve-edit.js";

describe("hue-curve-edit", () => {
  it("hueDisplayPoints gives 6 neutral points when empty", () => {
    const p = hueDisplayPoints([]);
    expect(p).toHaveLength(6);
    expect(p.every((q) => q.y === 0.5)).toBe(true);
    expect(p.map((q) => q.x)).toEqual([0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6]);
  });
  it("hueDisplayPoints passes through non-empty points", () => {
    const pts = [{ x: 0.2, y: 0.7 }, { x: 0.8, y: 0.3 }];
    expect(hueDisplayPoints(pts)).toEqual(pts);
  });
  it("evalHuePolyline returns steps+1 samples spanning [0,1]", () => {
    const line = evalHuePolyline([], 8);
    expect(line).toHaveLength(9);
    expect(line[0]!.x).toBe(0);
    expect(line[8]!.x).toBe(1);
    expect(line.every((q) => Math.abs(q.y - 0.5) < 1e-6)).toBe(true); // neutral is flat 0.5
  });
  it("isNeutralHueCurve", () => {
    expect(isNeutralHueCurve([])).toBe(true);
    expect(isNeutralHueCurve([{ x: 0, y: 0.5 }, { x: 0.5, y: 0.5 }])).toBe(true);
    expect(isNeutralHueCurve([{ x: 0.5, y: 0.8 }])).toBe(false);
  });
});
