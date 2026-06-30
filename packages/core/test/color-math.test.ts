import { describe, it, expect } from "vitest";
import {
  rgbToHsv, hsvToRgb, applyExposure, applyContrast, applySaturation, chromaOffset,
  applyColorWheels, applyCurves, applyHueCurves, applyChromaKey, type RGB,
} from "../src/color/color-math.js";

const close = (a: number, b: number, e = 1e-3) => Math.abs(a - b) < e;
const rgb = (r: number, g: number, b: number): RGB => ({ r, g, b });

describe("hsv round-trip", () => {
  it("rgb->hsv->rgb is identity", () => {
    for (const c of [rgb(0.6, 0.2, 0.3), rgb(0.1, 0.9, 0.4), rgb(0.5, 0.5, 0.5)]) {
      const hsv = rgbToHsv(c); const back = hsvToRgb(hsv);
      expect(close(back.r, c.r) && close(back.g, c.g) && close(back.b, c.b)).toBe(true);
    }
  });
});

describe("basic ops", () => {
  it("exposure 0 is identity; +1ev brightens", () => {
    const g = rgb(0.5, 0.5, 0.5);
    expect(close(applyExposure(g, 0).r, 0.5)).toBe(true);
    expect(applyExposure(g, 1).r).toBeGreaterThan(0.5);
  });
  it("contrast pivots at 0.5", () => {
    expect(close(applyContrast(rgb(0.5, 0.5, 0.5), 1.5).r, 0.5)).toBe(true);
    expect(applyContrast(rgb(0.7, 0.7, 0.7), 1.5).r).toBeGreaterThan(0.7);
  });
  it("saturation 0 desaturates to luma grey", () => {
    const r = applySaturation(rgb(0.8, 0.2, 0.2), 0);
    expect(close(r.r, r.g) && close(r.g, r.b)).toBe(true);
  });
});

describe("chromaOffset", () => {
  it("is luma-neutral (channel mean ~0) and zero at origin", () => {
    const o = chromaOffset(0.5, 0.0);
    expect(close((o.r + o.g + o.b) / 3, 0, 1e-3)).toBe(true);
    const z = chromaOffset(0, 0);
    expect(z.r === 0 && z.g === 0 && z.b === 0).toBe(true);
  });
});

describe("applyColorWheels neutral", () => {
  it("identity at neutral params (lift 0, gamma_m 1, gain_m 1)", () => {
    const c = rgb(0.4, 0.5, 0.6);
    const r = applyColorWheels(c, { x: 0, y: 0, m: 0 }, { x: 0, y: 0, m: 1 }, { x: 0, y: 0, m: 1 });
    expect(close(r.r, 0.4) && close(r.g, 0.5) && close(r.b, 0.6)).toBe(true);
  });
});

describe("applyCurves", () => {
  it("master is a luma-proportional rescale (hue-neutral on grey)", () => {
    const id = { master: [], red: [], green: [], blue: [] };
    expect(close(applyCurves(rgb(0.5, 0.5, 0.5), id).r, 0.5)).toBe(true);
    const lift = { master: [{ x: 0, y: 0 }, { x: 0.5, y: 0.75 }, { x: 1, y: 1 }], red: [], green: [], blue: [] };
    const out = applyCurves(rgb(0.4, 0.5, 0.6), lift);
    // proportional: ratio preserved approx
    expect(out.r / out.g).toBeCloseTo(0.4 / 0.5, 1);
  });
});

describe("applyHueCurves neutral", () => {
  it("identity at neutral curves", () => {
    const c = rgb(0.8, 0.2, 0.2);
    const r = applyHueCurves(c, { hueVsHue: [], hueVsSat: [], hueVsLum: [] });
    expect(close(r.r, 0.8, 1e-2) && close(r.g, 0.2, 1e-2)).toBe(true);
  });
});

describe("applyChromaKey", () => {
  it("keys out a saturated green pixel and spares a desaturated one", () => {
    const green = applyChromaKey({ r: 0.1, g: 0.9, b: 0.1, a: 1 }, 0.333, 0.5, 0.5, 0.5);
    expect(green.a).toBeLessThan(0.5);
    const grey = applyChromaKey({ r: 0.5, g: 0.52, b: 0.5, a: 1 }, 0.333, 0.5, 0.5, 0.5);
    expect(grey.a).toBeGreaterThan(0.9);
  });
});

describe("golden pins", () => {
  it("chromaOffset(1, 0) exact r/g/b", () => {
    const o = chromaOffset(1, 0);
    expect(o.r).toBeCloseTo(2 / 3, 5);
    expect(o.g).toBeCloseTo(-1 / 3, 5);
    expect(o.b).toBeCloseTo(-1 / 3, 5);
  });

  it("applyColorWheels lift-only on rgb(0.4,0.5,0.6)", () => {
    const out = applyColorWheels(rgb(0.4, 0.5, 0.6), { x: 0, y: 0, m: 0.1 }, { x: 0, y: 0, m: 1 }, { x: 0, y: 0, m: 1 });
    expect(out.r).toBeCloseTo(0.46, 5);
    expect(out.g).toBeCloseTo(0.55, 5);
    expect(out.b).toBeCloseTo(0.64, 5);
  });

  it("applyCurves master [{0,0},{0.5,0.75},{1,1}] on rgb(0.4,0.5,0.6)", () => {
    const curve = { master: [{ x: 0, y: 0 }, { x: 0.5, y: 0.75 }, { x: 1, y: 1 }], red: [], green: [], blue: [] };
    const out = applyCurves(rgb(0.4, 0.5, 0.6), curve);
    expect(out.r).toBeCloseTo(0.6, 5);
    expect(out.g).toBeCloseTo(0.75, 5);
    expect(out.b).toBeCloseTo(0.9, 5);
  });

  it("applyHueCurves hueVsHue uniform shift on pure red", () => {
    const curves = { hueVsHue: [{ x: 0, y: 0.75 }, { x: 1, y: 0.75 }], hueVsSat: [], hueVsLum: [] };
    const out = applyHueCurves(rgb(1, 0, 0), curves);
    expect(out.r).toBeCloseTo(1, 5);
    expect(out.g).toBeCloseTo(0.25, 5);
    expect(out.b).toBeCloseTo(0, 5);
  });

  it("applyChromaKey exact alpha on green pixel (0.1,0.9,0.1)", () => {
    const green = applyChromaKey({ r: 0.1, g: 0.9, b: 0.1, a: 1 }, 0.333, 0.5, 0.5, 0.5);
    expect(green.a).toBeCloseTo(0, 5);
  });
});
