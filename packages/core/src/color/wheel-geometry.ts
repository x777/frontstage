import { hsvToRgb } from "./color-math.js";

export function pointToXY(px: number, py: number, cx: number, cy: number, radius: number): { x: number; y: number } {
  let x = (px - cx) / radius;
  let y = -(py - cy) / radius; // screen y-down → wheel y-up
  const mag = Math.hypot(x, y);
  if (mag > 1) { x /= mag; y /= mag; }
  return { x, y };
}

export function xyToPuck(x: number, y: number, cx: number, cy: number, radius: number): { px: number; py: number } {
  return { px: cx + x * radius, py: cy - y * radius };
}

// Ported from Swift ColorWheels.displayColor(x:y:). Uses hsvToRgb({h,s:1,v:1}) for the
// fully-saturated hue (equivalent to Swift's internal hueRGB helper), then applies the
// dark-body + vivid-rim blending formula.
export function wheelDisplayColor(x: number, y: number): { r: number; g: number; b: number } {
  const r = Math.min(1, Math.hypot(x, y));
  const hue = (Math.atan2(y, x) / (2 * Math.PI) % 1 + 1) % 1;
  const { r: hr, g: hg, b: hb } = hsvToRgb({ h: hue, s: 1, v: 1 });
  const v = 0.08 + 0.5 * Math.pow(r, 1.7);
  const s = Math.pow(r, 1.4);
  const t = Math.min(1, Math.max(0, (r - 0.86) / 0.14));
  const rim = t * t * (3 - 2 * t); // smoothstep rim ramp over outer 14%
  const face = (h: number) => { const body = v * ((1 - s) + h * s); return body + (h - body) * rim; };
  return { r: face(hr), g: face(hg), b: face(hb) };
}
