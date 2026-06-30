import { evalCurve, evalHueCurve, type GradeCurve, type HueCurves } from "./grade-curve.js";
import type { RGBA } from "../text-style.js";

export interface RGB { r: number; g: number; b: number }

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const REC709 = (c: RGB) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
const srgbToLin = (x: number) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
const linToSrgb = (x: number) => (x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);

export interface HSV { h: number; s: number; v: number }
export function rgbToHsv(c: RGB): HSV {
  const max = Math.max(c.r, c.g, c.b), min = Math.min(c.r, c.g, c.b), d = max - min;
  let h = 0;
  if (d > 1e-9) {
    if (max === c.r) h = ((c.g - c.b) / d) % 6;
    else if (max === c.g) h = (c.b - c.r) / d + 2;
    else h = (c.r - c.g) / d + 4;
    h /= 6; if (h < 0) h += 1;
  }
  return { h, s: max <= 0 ? 0 : d / max, v: max };
}
export function hsvToRgb(c: HSV): RGB {
  const h = ((c.h % 1) + 1) % 1, i = Math.floor(h * 6), f = h * 6 - i;
  const p = c.v * (1 - c.s), q = c.v * (1 - f * c.s), t = c.v * (1 - (1 - f) * c.s);
  switch (i % 6) {
    case 0: return { r: c.v, g: t, b: p };
    case 1: return { r: q, g: c.v, b: p };
    case 2: return { r: p, g: c.v, b: t };
    case 3: return { r: p, g: q, b: c.v };
    case 4: return { r: t, g: p, b: c.v };
    default: return { r: c.v, g: p, b: q };
  }
}

export function applyExposure(c: RGB, ev: number): RGB {
  const k = Math.pow(2, ev);
  return { r: linToSrgb(srgbToLin(c.r) * k), g: linToSrgb(srgbToLin(c.g) * k), b: linToSrgb(srgbToLin(c.b) * k) };
}
export function applyContrast(c: RGB, amount: number): RGB {
  return { r: (c.r - 0.5) * amount + 0.5, g: (c.g - 0.5) * amount + 0.5, b: (c.b - 0.5) * amount + 0.5 };
}
export function applySaturation(c: RGB, amount: number): RGB {
  const y = REC709(c);
  return { r: y + (c.r - y) * amount, g: y + (c.g - y) * amount, b: y + (c.b - y) * amount };
}
export function applyVibrance(c: RGB, amount: number): RGB {
  const hsv = rgbToHsv(c);
  const boost = amount * (1 - hsv.s);
  return applySaturation(c, 1 + boost);
}
export function applyHighlightsShadows(c: RGB, highlights: number, shadows: number): RGB {
  const adj = (x: number) => {
    const shadowMask = 1 - smoothstep(0, 0.5, x);
    const hiMask = smoothstep(0.5, 1, x);
    return clamp01(x + shadows * 0.5 * shadowMask + highlights * 0.5 * hiMask);
  };
  return { r: adj(c.r), g: adj(c.g), b: adj(c.b) };
}
export function applyBlacksWhites(c: RGB, blacks: number, whites: number): RGB {
  const lo = blacks * 0.25, hi = 1 + whites * 0.25;
  const adj = (x: number) => clamp01((x - lo) / Math.max(1e-3, hi - lo));
  return { r: adj(c.r), g: adj(c.g), b: adj(c.b) };
}
export function applyTemperatureTint(c: RGB, temperatureK: number, tint: number): RGB {
  const t = (temperatureK - 6500) / 4500; // -1..~1
  const rs = 1 + t * 0.2, bs = 1 - t * 0.2, gs = 1 - (tint / 100) * 0.2;
  return { r: clamp01(c.r * rs), g: clamp01(c.g * gs), b: clamp01(c.b * bs) };
}
function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

export function chromaOffset(x: number, y: number): RGB {
  const r = Math.min(1, Math.sqrt(x * x + y * y));
  if (r <= 1e-6) return { r: 0, g: 0, b: 0 };
  let hue = Math.atan2(y, x) / (2 * Math.PI);
  hue = ((hue % 1) + 1) % 1;
  const c = hsvToRgb({ h: hue, s: r, v: 1 });
  const mean = (c.r + c.g + c.b) / 3;
  return { r: c.r - mean, g: c.g - mean, b: c.b - mean };
}

const CHROMA_LIFT = 0.2, CHROMA_GAIN = 0.35, CHROMA_GAMMA = 0.35;
export function applyColorWheels(
  c: RGB,
  lift: { x: number; y: number; m: number },
  gamma: { x: number; y: number; m: number },
  gain: { x: number; y: number; m: number },
): RGB {
  const lo = chromaOffset(lift.x, lift.y), go = chromaOffset(gamma.x, gamma.y), ga = chromaOffset(gain.x, gain.y);
  const ch = (inp: number, k: "r" | "g" | "b"): number => {
    const liftC = lift.m + lo[k] * CHROMA_LIFT;
    const gainC = gain.m * (1 + ga[k] * CHROMA_GAIN);
    const invGamma = 1 / Math.max(0.01, gamma.m * (1 + go[k] * CHROMA_GAMMA));
    return clamp01(Math.pow(Math.max(0, inp * (1 - liftC) + liftC) * gainC, invGamma));
  };
  return { r: ch(c.r, "r"), g: ch(c.g, "g"), b: ch(c.b, "b") };
}

export function applyCurves(c: RGB, curve: GradeCurve): RGB {
  let { r, g, b } = c;
  const y = REC709({ r, g, b });
  const yp = evalCurve(curve.master, y);
  if (y > 1e-4) { const k = Math.min(yp / y, 8.0); r *= k; g *= k; b *= k; } else { r = yp; g = yp; b = yp; }
  return { r: evalCurve(curve.red, r), g: evalCurve(curve.green, g), b: evalCurve(curve.blue, b) };
}

const MAX_HUE_SHIFT = 1 / 12, MAX_LUM_SHIFT = 0.5;
export function applyHueCurves(c: RGB, curves: HueCurves): RGB {
  const hsv = rgbToHsv(c);
  const dHue = (evalHueCurve(curves.hueVsHue, hsv.h) - 0.5) * 2 * MAX_HUE_SHIFT;
  const satScale = (evalHueCurve(curves.hueVsSat, hsv.h) - 0.5) * 2;
  const dLum = (evalHueCurve(curves.hueVsLum, hsv.h) - 0.5) * 2 * MAX_LUM_SHIFT;
  const gate = smoothstep(0.04, 0.18, hsv.s);
  return hsvToRgb({
    h: ((hsv.h + dHue * gate) % 1 + 1) % 1,
    s: clamp01(hsv.s * (1 + satScale * gate)),
    v: clamp01(hsv.v + dLum * gate),
  });
}

export function applyChromaKey(c: RGBA, keyHue: number, tolerance: number, softness: number, spill: number): RGBA {
  const hsv = rgbToHsv(c);
  const diff = Math.abs(hsv.h - keyHue);
  const hd = Math.min(diff, 1 - diff);
  const inner = tolerance * 0.25;
  const key = (1 - smoothstep(inner, inner + softness * 0.3 + 0.02, hd)) * smoothstep(0.12, 0.32, hsv.s);
  const yGrey = REC709(c);
  const m = spill * key;
  return {
    r: c.r * (1 - m) + yGrey * m,
    g: c.g * (1 - m) + yGrey * m,
    b: c.b * (1 - m) + yGrey * m,
    a: c.a * (1 - key),
  };
}
