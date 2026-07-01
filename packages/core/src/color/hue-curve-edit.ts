import type { CurvePoint } from "./grade-curve.js";
import { evalHueCurve } from "./grade-curve.js";

export function hueDisplayPoints(points: CurvePoint[]): CurvePoint[] {
  if (points.length > 0) return points;
  return Array.from({ length: 6 }, (_, i) => ({ x: i / 6, y: 0.5 }));
}

export function evalHuePolyline(points: CurvePoint[], steps: number): CurvePoint[] {
  const dp = hueDisplayPoints(points);
  const out: CurvePoint[] = [];
  for (let i = 0; i <= steps; i++) { const x = i / steps; out.push({ x, y: evalHueCurve(dp, x) }); }
  return out;
}

export function isNeutralHueCurve(points: CurvePoint[]): boolean {
  return points.length === 0 || points.every((p) => Math.abs(p.y - 0.5) < 1e-4);
}
