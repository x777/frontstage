import { describe, it, expect } from "vitest";
import { blendPixel, type RGBA } from "../src/color/blend-mode.js";

const c = (r: number, g: number, b: number): RGBA => ({ r, g, b, a: 1 });
const close = (a: number, b: number) => Math.abs(a - b) < 1e-4;

describe("blendPixel separable modes", () => {
  const s = c(0.6, 0.4, 0.8), d = c(0.5, 0.5, 0.5);
  it("normal returns src rgb", () => expect(blendPixel("normal", s, d)).toMatchObject({ r: 0.6, g: 0.4, b: 0.8 }));
  it("multiply = s*d", () => { const r = blendPixel("multiply", s, d); expect(close(r.r, 0.3)).toBe(true); });
  it("screen = 1-(1-s)(1-d)", () => { const r = blendPixel("screen", s, d); expect(close(r.r, 0.8)).toBe(true); });
  it("darken/lighten pick min/max", () => {
    expect(close(blendPixel("darken", s, d).r, 0.5)).toBe(true);
    expect(close(blendPixel("lighten", s, d).r, 0.6)).toBe(true);
  });
  it("difference = |s-d|", () => expect(close(blendPixel("difference", s, d).r, 0.1)).toBe(true));
  it("overlay on a 0.5 backdrop equals 2*s*0.5 = s for the low half", () => {
    // overlay(d<=0.5): 2*s*d -> r: 2*0.6*0.5 = 0.6
    expect(close(blendPixel("overlay", s, d).r, 0.6)).toBe(true);
  });
});

describe("blendPixel non-separable HSL modes", () => {
  it("luminosity takes dst hue+sat with src luminosity", () => {
    const r = blendPixel("luminosity", c(0.2, 0.2, 0.2), c(0.8, 0.2, 0.2));
    // result luminosity ~ src (0.2), chroma from dst (reddish)
    const lum = 0.3 * r.r + 0.59 * r.g + 0.11 * r.b;
    expect(close(lum, 0.2)).toBe(true);
  });
  it("color takes dst luminosity with src hue+sat", () => {
    const r = blendPixel("color", c(0.8, 0.2, 0.2), c(0.5, 0.5, 0.5));
    const lum = 0.3 * r.r + 0.59 * r.g + 0.11 * r.b;
    expect(close(lum, 0.5)).toBe(true); // keeps backdrop luminosity
  });
});
