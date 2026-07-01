import { describe, it, expect } from "vitest";
import { histogramYRGB } from "../src/color/histogram.js";

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
