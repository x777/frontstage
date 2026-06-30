import type { RGBA } from "../text-style.js";
export type { RGBA };

export type BlendMode =
  | "normal" | "darken" | "multiply" | "colorBurn" | "lighten" | "screen" | "colorDodge"
  | "overlay" | "softLight" | "hardLight" | "difference" | "exclusion"
  | "hue" | "saturation" | "color" | "luminosity";

export const BLEND_MODES: readonly BlendMode[] = [
  "normal", "darken", "multiply", "colorBurn", "lighten", "screen", "colorDodge",
  "overlay", "softLight", "hardLight", "difference", "exclusion",
  "hue", "saturation", "color", "luminosity",
];

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function sep(mode: BlendMode, s: number, d: number): number {
  switch (mode) {
    case "darken": return Math.min(s, d);
    case "lighten": return Math.max(s, d);
    case "multiply": return s * d;
    case "screen": return s + d - s * d;
    case "colorBurn": return d <= 0 ? 0 : s <= 0 ? 0 : 1 - Math.min(1, (1 - d) / s);
    case "colorDodge": return d <= 0 ? 0 : s >= 1 ? 1 : Math.min(1, d / (1 - s));
    case "hardLight": return s <= 0.5 ? d * (2 * s) : 1 - (1 - d) * (1 - 2 * (s - 0.5));
    case "overlay": return d <= 0.5 ? s * (2 * d) : 1 - (1 - s) * (1 - 2 * (d - 0.5));
    case "softLight": {
      if (s <= 0.5) return d - (1 - 2 * s) * d * (1 - d);
      const dd = d <= 0.25 ? ((16 * d - 12) * d + 4) * d : Math.sqrt(d);
      return d + (2 * s - 1) * (dd - d);
    }
    case "difference": return Math.abs(s - d);
    case "exclusion": return s + d - 2 * s * d;
    default: return s;
  }
}

// W3C non-separable helpers (Rec.601-ish luminosity coefficients per the W3C blending spec).
const lum = (r: number, g: number, b: number) => 0.3 * r + 0.59 * g + 0.11 * b;
function clipColor(r: number, g: number, b: number): [number, number, number] {
  const l = lum(r, g, b), n = Math.min(r, g, b), x = Math.max(r, g, b);
  if (n < 0) { r = l + ((r - l) * l) / (l - n); g = l + ((g - l) * l) / (l - n); b = l + ((b - l) * l) / (l - n); }
  if (x > 1) { r = l + ((r - l) * (1 - l)) / (x - l); g = l + ((g - l) * (1 - l)) / (x - l); b = l + ((b - l) * (1 - l)) / (x - l); }
  return [r, g, b];
}
function setLum(r: number, g: number, b: number, l: number): [number, number, number] {
  const d = l - lum(r, g, b);
  return clipColor(r + d, g + d, b + d);
}
const sat = (r: number, g: number, b: number) => Math.max(r, g, b) - Math.min(r, g, b);
function setSat(r: number, g: number, b: number, s: number): [number, number, number] {
  const arr = [["r", r], ["g", g], ["b", b]] as [string, number][];
  arr.sort((a, b2) => a[1] - b2[1]);
  const out: Record<string, number> = {};
  if (arr[2]![1] > arr[0]![1]) {
    out[arr[1]![0]] = ((arr[1]![1] - arr[0]![1]) * s) / (arr[2]![1] - arr[0]![1]);
    out[arr[2]![0]] = s;
  } else { out[arr[1]![0]] = 0; out[arr[2]![0]] = 0; }
  out[arr[0]![0]] = 0;
  return [out.r!, out.g!, out.b!];
}

export function blendPixel(mode: BlendMode, src: RGBA, dst: RGBA): RGBA {
  if (mode === "normal") return { ...src };
  let r: number, g: number, b: number;
  if (mode === "hue" || mode === "saturation" || mode === "color" || mode === "luminosity") {
    const s = src, d = dst;
    if (mode === "hue") { const [r0, g0, b0] = setSat(s.r, s.g, s.b, sat(d.r, d.g, d.b)); [r, g, b] = setLum(r0, g0, b0, lum(d.r, d.g, d.b)); }
    else if (mode === "saturation") { const [r0, g0, b0] = setSat(d.r, d.g, d.b, sat(s.r, s.g, s.b)); [r, g, b] = setLum(r0, g0, b0, lum(d.r, d.g, d.b)); }
    else if (mode === "color") { [r, g, b] = setLum(s.r, s.g, s.b, lum(d.r, d.g, d.b)); }
    else { [r, g, b] = setLum(d.r, d.g, d.b, lum(s.r, s.g, s.b)); }
  } else {
    r = sep(mode, src.r, dst.r); g = sep(mode, src.g, dst.g); b = sep(mode, src.b, dst.b);
  }
  return { r: clamp01(r), g: clamp01(g), b: clamp01(b), a: src.a };
}
