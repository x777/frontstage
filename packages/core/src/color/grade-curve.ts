export interface CurvePoint { x: number; y: number }
export interface GradeCurve { master: CurvePoint[]; red: CurvePoint[]; green: CurvePoint[]; blue: CurvePoint[] }
export interface HueCurves { hueVsHue: CurvePoint[]; hueVsSat: CurvePoint[]; hueVsLum: CurvePoint[] }

export function curveIsIdentity(points: CurvePoint[]): boolean {
  if (points.length === 0) return true;
  return points.length === 2 && points[0]!.x === 0 && points[0]!.y === 0 && points[1]!.x === 1 && points[1]!.y === 1;
}

export function evalCurve(points: CurvePoint[], x: number): number {
  if (curveIsIdentity(points)) return x;
  const pts = [...points].sort((a, b) => a.x - b.x);
  if (x <= pts[0]!.x) return pts[0]!.y;
  if (x >= pts[pts.length - 1]!.x) return pts[pts.length - 1]!.y;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!, b = pts[i + 1]!;
    if (x >= a.x && x <= b.x) {
      const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x);
      return a.y + (b.y - a.y) * t;
    }
  }
  return pts[pts.length - 1]!.y;
}

// 6 uniformly-spaced default points all at y=0.5 (Swift HueCurves default).
const HUE_DEFAULTS: CurvePoint[] = Array.from({ length: 6 }, (_, i) => ({ x: i / 6, y: 0.5 }));

export function evalHueCurve(points: CurvePoint[], hue: number): number {
  const pts = (points.length === 0 ? HUE_DEFAULTS : [...points]).sort((a, b) => a.x - b.x);
  const h = ((hue % 1) + 1) % 1;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    const ax = a.x;
    let bx = b.x;
    if (i === pts.length - 1) bx = b.x + 1; // wrap
    let hh = h;
    if (i === pts.length - 1 && h < ax) hh = h + 1;
    if (hh >= ax && hh <= bx) {
      const t = bx === ax ? 0 : (hh - ax) / (bx - ax);
      return a.y + (b.y - a.y) * t;
    }
  }
  return pts[0]!.y;
}

export function hueCurvesAreNeutral(c: HueCurves): boolean {
  const neutral = (pts: CurvePoint[]) => pts.length === 0 || pts.every((p) => Math.abs(p.y - 0.5) < 1e-4);
  return neutral(c.hueVsHue) && neutral(c.hueVsSat) && neutral(c.hueVsLum);
}

const arr = (v: unknown): CurvePoint[] =>
  Array.isArray(v) ? v.filter((p): p is CurvePoint => typeof p?.x === "number" && typeof p?.y === "number") : [];

export function parseGradeCurve(json: string | undefined): GradeCurve {
  try {
    const o = JSON.parse(json ?? "");
    return { master: arr(o.master), red: arr(o.red), green: arr(o.green), blue: arr(o.blue) };
  } catch { return { master: [], red: [], green: [], blue: [] }; }
}

export function parseHueCurves(json: string | undefined): HueCurves {
  try {
    const o = JSON.parse(json ?? "");
    return { hueVsHue: arr(o.hueVsHue), hueVsSat: arr(o.hueVsSat), hueVsLum: arr(o.hueVsLum) };
  } catch { return { hueVsHue: [], hueVsSat: [], hueVsLum: [] }; }
}
