import type { RGB } from "./color-math.js";

export interface CubeLUT { dimension: number; data: Float32Array } // RGBA, length dim^3 * 4, r-fastest

export function parseCubeLUT(text: string): CubeLUT | null {
  let dimension = 0;
  const domainMin = [0, 0, 0];
  const domainMax = [1, 1, 1];
  const triples: number[][] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#") || line.startsWith("TITLE")) continue;
    if (line.startsWith("LUT_1D_SIZE")) return null;
    if (line.startsWith("LUT_3D_SIZE")) { dimension = parseInt(line.split(/\s+/)[1]!, 10); continue; }
    if (line.startsWith("DOMAIN_MIN")) { const p = line.split(/\s+/); for (let i = 0; i < 3; i++) domainMin[i] = parseFloat(p[i + 1]!); continue; }
    if (line.startsWith("DOMAIN_MAX")) { const p = line.split(/\s+/); for (let i = 0; i < 3; i++) domainMax[i] = parseFloat(p[i + 1]!); continue; }
    const parts = line.split(/\s+/).map(Number);
    if (parts.length >= 3 && parts.slice(0, 3).every((n) => Number.isFinite(n))) triples.push([parts[0]!, parts[1]!, parts[2]!]);
  }
  if (!(dimension > 1 && dimension <= 64)) return null;
  if (triples.length !== dimension ** 3) return null;
  const data = new Float32Array(dimension ** 3 * 4);
  for (let i = 0; i < triples.length; i++) {
    for (let c = 0; c < 3; c++) {
      const span = domainMax[c]! - domainMin[c]!;
      data[i * 4 + c] = span === 0 ? 0 : (triples[i]![c]! - domainMin[c]!) / span;
    }
    data[i * 4 + 3] = 1;
  }
  return { dimension, data };
}

export function sampleLUT(lut: CubeLUT, rgb: RGB): RGB {
  const n = lut.dimension;
  const node = (r: number, g: number, b: number): RGB => {
    const idx = (b * n * n + g * n + r) * 4; // r-fastest
    return { r: lut.data[idx]!, g: lut.data[idx + 1]!, b: lut.data[idx + 2]! };
  };
  const scale = (x: number) => Math.max(0, Math.min(n - 1, x * (n - 1)));
  const px = scale(rgb.r), py = scale(rgb.g), pz = scale(rgb.b);
  const r0 = Math.floor(px), g0 = Math.floor(py), b0 = Math.floor(pz);
  const r1 = Math.min(r0 + 1, n - 1), g1 = Math.min(g0 + 1, n - 1), b1 = Math.min(b0 + 1, n - 1);
  const fr = px - r0, fg = py - g0, fb = pz - b0;
  const c000 = node(r0, g0, b0), c111 = node(r1, g1, b1);
  const lerp = (a: RGB, c: RGB, t: number): RGB => ({ r: a.r + (c.r - a.r) * t, g: a.g + (c.g - a.g) * t, b: a.b + (c.b - a.b) * t });
  const add = (a: RGB, c: RGB, w: number): RGB => ({ r: a.r + c.r * w, g: a.g + c.g * w, b: a.b + c.b * w });
  // Tetrahedral: pick the tetra by ordering of fr,fg,fb.
  let out: RGB;
  if (fr >= fg && fg >= fb) out = combine(c000, node(r1, g0, b0), node(r1, g1, b0), c111, fr, fg, fb);
  else if (fr >= fb && fb >= fg) out = combine(c000, node(r1, g0, b0), node(r1, g0, b1), c111, fr, fb, fg);
  else if (fb >= fr && fr >= fg) out = combine(c000, node(r0, g0, b1), node(r1, g0, b1), c111, fb, fr, fg);
  else if (fg >= fr && fr >= fb) out = combine(c000, node(r0, g1, b0), node(r1, g1, b0), c111, fg, fr, fb);
  else if (fg >= fb && fb >= fr) out = combine(c000, node(r0, g1, b0), node(r0, g1, b1), c111, fg, fb, fr);
  else out = combine(c000, node(r0, g0, b1), node(r0, g1, b1), c111, fb, fg, fr);
  void lerp; void add;
  return out;
}

// w0>=w1>=w2: c0*(1-w0) + cA*(w0-w1) + cB*(w1-w2) + c1*w2
function combine(c0: RGB, cA: RGB, cB: RGB, c1: RGB, w0: number, w1: number, w2: number): RGB {
  return {
    r: c0.r * (1 - w0) + cA.r * (w0 - w1) + cB.r * (w1 - w2) + c1.r * w2,
    g: c0.g * (1 - w0) + cA.g * (w0 - w1) + cB.g * (w1 - w2) + c1.g * w2,
    b: c0.b * (1 - w0) + cA.b * (w0 - w1) + cB.b * (w1 - w2) + c1.b * w2,
  };
}
