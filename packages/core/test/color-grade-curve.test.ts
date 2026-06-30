import { describe, it, expect } from "vitest";
import { evalCurve, evalHueCurve, curveIsIdentity, hueCurvesAreNeutral, parseGradeCurve, parseHueCurves } from "../src/color/grade-curve.js";

const close = (a: number, b: number) => Math.abs(a - b) < 1e-4;

describe("evalCurve", () => {
  it("identity for empty or [(0,0),(1,1)]", () => {
    expect(evalCurve([], 0.3)).toBe(0.3);
    expect(evalCurve([{ x: 0, y: 0 }, { x: 1, y: 1 }], 0.3)).toBe(0.3);
    expect(curveIsIdentity([])).toBe(true);
    expect(curveIsIdentity([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(true);
  });
  it("piecewise-linear interpolation + endpoint clamp", () => {
    const pts = [{ x: 0, y: 0 }, { x: 0.5, y: 1 }, { x: 1, y: 1 }];
    expect(close(evalCurve(pts, 0.25), 0.5)).toBe(true);
    expect(close(evalCurve(pts, -1), 0)).toBe(true); // clamp low
    expect(close(evalCurve(pts, 2), 1)).toBe(true);  // clamp high
  });
});

describe("evalHueCurve", () => {
  it("neutral 0.5 when empty", () => expect(close(evalHueCurve([], 0.7), 0.5)).toBe(true));
  it("cyclic interpolation wraps across the hue seam", () => {
    // points cover [0.3,0.7]; hue 0.0 falls in the wrap segment (0.7 -> 0.3+1)
    const pts = [{ x: 0.3, y: 0.2 }, { x: 0.7, y: 0.8 }];
    // at hue 0.0: t = (1.0 - 0.7) / (1.3 - 0.7) = 0.5 -> 0.8 + (0.2-0.8)*0.5 = 0.5
    expect(close(evalHueCurve(pts, 0.0), 0.5)).toBe(true);
  });
});

describe("hueCurvesAreNeutral", () => {
  it("true for empty channels", () => expect(hueCurvesAreNeutral({ hueVsHue: [], hueVsSat: [], hueVsLum: [] })).toBe(true));
  it("false when any channel deviates from 0.5", () => expect(hueCurvesAreNeutral({ hueVsHue: [{ x: 0, y: 0.9 }], hueVsSat: [], hueVsLum: [] })).toBe(false));
});

describe("parse", () => {
  it("round-trips a GradeCurve JSON and falls back to identity on bad JSON", () => {
    const g = parseGradeCurve(JSON.stringify({ master: [{ x: 0, y: 0.1 }], red: [], green: [], blue: [] }));
    expect(g.master[0]!.y).toBe(0.1);
    expect(parseGradeCurve("{bad").master).toEqual([]);
  });
  it("parses HueCurves and falls back to neutral on bad JSON", () => {
    expect(parseHueCurves("nope").hueVsHue).toEqual([]);
  });
});
