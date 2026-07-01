import { describe, it, expect } from "vitest";
import { histogramYRGB, hueHistogram } from "../src/color/histogram.js";

describe("histogramYRGB", () => {
  it("a solid grey image puts all weight in one bin", () => {
    const w = 4, h = 4; const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) { rgba[i*4]=128; rgba[i*4+1]=128; rgba[i*4+2]=128; rgba[i*4+3]=255; }
    const hgram = histogramYRGB(rgba, w, h, 256);
    expect(hgram.r[128]).toBe(16);
    expect(hgram.y[128]).toBe(16); // luma of grey 128 = 128
    expect(hgram.r.reduce((a, b) => a + b, 0)).toBe(16);
  });
  it("respects the bin count", () => {
    const rgba = new Uint8Array([255,0,0,255]);
    const h = histogramYRGB(rgba, 1, 1, 4);
    expect(h.r[3]).toBe(1); // 255 → top bin of 4
    expect(h.g[0]).toBe(1);
  });
});

describe("hueHistogram", () => {
  it("a saturated red image weights the red-hue bin", () => {
    const w = 4, h = 4; const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) { rgba[i*4]=255; rgba[i*4+1]=0; rgba[i*4+2]=0; rgba[i*4+3]=255; }
    const hg = hueHistogram(rgba, w, h, 96);
    expect(hg[0]).toBeGreaterThan(0); // red hue ≈ 0 → first bin
    expect(hg.reduce((a, b) => a + b, 0)).toBeCloseTo(16, 3); // 16 px × saturation 1
  });
  it("a grey image contributes ~zero (saturation 0)", () => {
    const rgba = new Uint8Array(4 * 4); for (let i = 0; i < 4; i++) { rgba[i*4]=128; rgba[i*4+1]=128; rgba[i*4+2]=128; rgba[i*4+3]=255; }
    const hg = hueHistogram(rgba, 2, 2, 96);
    expect(hg.reduce((a, b) => a + b, 0)).toBeLessThan(1e-6);
  });
});
