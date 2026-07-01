import type { CurvePoint } from "./grade-curve.js";
import { evalCurve } from "./grade-curve.js";

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const IDENTITY: CurvePoint[] = [{ x: 0, y: 0 }, { x: 1, y: 1 }];

export function displayPoints(points: CurvePoint[]): CurvePoint[] {
  return points.length >= 2 ? points : IDENTITY.map((p) => ({ ...p }));
}

export function nearestPoint(points: CurvePoint[], x: number, y: number, hitRadius: number): number {
  let best = -1, bestD = hitRadius;
  points.forEach((p, i) => { const d = Math.hypot(p.x - x, p.y - y); if (d <= bestD) { bestD = d; best = i; } });
  return best;
}

export function addPoint(points: CurvePoint[], x: number, y: number): { points: CurvePoint[]; index: number } {
  const np = { x: clamp01(x), y: clamp01(y) };
  const pts = [...points, np].sort((a, b) => a.x - b.x);
  return { points: pts, index: pts.indexOf(np) };
}

export function movePoint(points: CurvePoint[], index: number, x: number, y: number): CurvePoint[] {
  const pts = points.map((p) => ({ ...p }));
  const ny = clamp01(y);
  if (index === 0 || index === pts.length - 1) { pts[index]!.y = ny; return pts; }
  const lo = pts[index - 1]!.x + 0.001, hi = pts[index + 1]!.x - 0.001;
  pts[index]!.x = Math.max(lo, Math.min(hi, x));
  pts[index]!.y = ny;
  return pts;
}

export function removePoint(points: CurvePoint[], index: number): CurvePoint[] {
  if (index <= 0 || index >= points.length - 1 || points.length <= 2) return points;
  return points.filter((_, i) => i !== index);
}

export function evalPolyline(points: CurvePoint[], steps: number): CurvePoint[] {
  const dp = displayPoints(points);
  const out: CurvePoint[] = [];
  for (let i = 0; i <= steps; i++) { const x = i / steps; out.push({ x, y: evalCurve(dp, x) }); }
  return out;
}

export function isIdentityCurve(points: CurvePoint[]): boolean {
  return points.length === 0 || (points.length === 2 && points[0]!.x === 0 && points[0]!.y === 0 && points[1]!.x === 1 && points[1]!.y === 1);
}
