import type { Effect, EffectParam } from "./effect.js";
import { effectDescriptor, canonicalIndex, defaultEffect } from "./effect-registry.js";
import type { CurvePoint, GradeCurve, HueCurves } from "./grade-curve.js";
import { parseGradeCurve, parseHueCurves } from "./grade-curve.js";
import type { Scopes } from "./scopes.js";

export interface ApplyColorInput {
  clipIds: string[]; reset?: boolean;
  exposure?: number; contrast?: number; saturation?: number; vibrance?: number;
  temperature?: number; tint?: number; highlights?: number; shadows?: number; blacks?: number; whites?: number;
  shadowsHue?: number; shadowsAmount?: number; shadowsLum?: number;
  midsHue?: number; midsAmount?: number; midsGamma?: number;
  highsHue?: number; highsAmount?: number; highsGain?: number;
  masterCurve?: [number, number][]; redCurve?: [number, number][]; greenCurve?: [number, number][]; blueCurve?: [number, number][];
  hueCurves?: { targets: { targetHue: number; hueShift?: number; satScale?: number; lumShift?: number }[] };
  lut?: { path?: string; strength?: number };
}
export interface EffectSpec { type: string; params?: Record<string, number>; enabled?: boolean }

const v = (value: number): EffectParam => ({ value });
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const xy = (hue: number, amount: number): [number, number] => {
  const a = (hue * Math.PI) / 180;
  return [amount * Math.cos(a), amount * Math.sin(a)];
};
function hueAmount(x: number, y: number): { hue?: number; amount?: number } {
  const r = Math.sqrt(x * x + y * y);
  if (r <= 1e-6) return {};
  let deg = (Math.atan2(y, x) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return { hue: deg, amount: r };
}
const pts = (arr: [number, number][] | undefined): CurvePoint[] =>
  (arr ?? []).map(([x, y]) => ({ x: clamp01(x), y: clamp01(y) }));

// Port of Swift compileHueCurves: localized bump at center=targetHue/360, band=0.06, neutral=0.5.
function compileHueCurves(targets: ApplyColorInput["hueCurves"]): HueCurves {
  const band = 0.06;
  const neutral = 0.5;
  const wrap01 = (x: number) => { const m = x % 1; return m < 0 ? m + 1 : m; };
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  const bump = (arr: CurvePoint[], center: number, y: number) => {
    arr.push({ x: wrap01(center), y }, { x: wrap01(center - band), y: neutral }, { x: wrap01(center + band), y: neutral });
  };
  const finalize = (arr: CurvePoint[]): CurvePoint[] => {
    if (!arr.length) return [];
    const byX = new Map<string, CurvePoint>();
    for (const p of [...arr].sort((a, b) => Math.abs(a.y - neutral) - Math.abs(b.y - neutral))) {
      byX.set(String(r3(p.x)), { x: r3(p.x), y: r3(p.y) });
    }
    return [...byX.values()].sort((a, b) => a.x - b.x);
  };
  const hue: CurvePoint[] = []; const sat: CurvePoint[] = []; const lum: CurvePoint[] = [];
  for (const t of targets?.targets ?? []) {
    const center = wrap01(t.targetHue / 360);
    if (t.hueShift !== undefined && Math.abs(t.hueShift) > 1e-6)
      bump(hue, center, neutral + Math.max(-30, Math.min(30, t.hueShift)) / 60);
    if (t.satScale !== undefined && Math.abs(t.satScale - 1) > 1e-6)
      bump(sat, center, neutral + (Math.max(0, Math.min(2, t.satScale)) - 1) / 2);
    if (t.lumShift !== undefined && Math.abs(t.lumShift) > 1e-6)
      bump(lum, center, neutral + Math.max(-0.5, Math.min(0.5, t.lumShift)));
  }
  return { hueVsHue: finalize(hue), hueVsSat: finalize(sat), hueVsLum: finalize(lum) };
}

interface GradeState {
  exposure: number; contrast: number; highlights: number; shadows: number; blacks: number; whites: number;
  temperature: number; tint: number; vibrance: number; saturation: number;
  shadowsHue?: number; shadowsAmount?: number; shadowsLum: number;
  midsHue?: number; midsAmount?: number; midsGamma: number;
  highsHue?: number; highsAmount?: number; highsGain: number;
  master: CurvePoint[]; red: CurvePoint[]; green: CurvePoint[]; blue: CurvePoint[];
  hue: HueCurves;
  lutPath?: string; lutIntensity: number;
}
function neutralState(): GradeState {
  return { exposure: 0, contrast: 1, highlights: 0, shadows: 0, blacks: 0, whites: 0, temperature: 6500, tint: 0, vibrance: 0, saturation: 1,
    shadowsLum: 0, midsGamma: 1, highsGain: 1, master: [], red: [], green: [], blue: [], hue: { hueVsHue: [], hueVsSat: [], hueVsLum: [] }, lutIntensity: 1 };
}
function decodeState(existing: Effect[]): GradeState {
  const s = neutralState();
  const p = (t: string, k: string) => existing.find((e) => e.type === t)?.params[k]?.value;
  if (p("color.exposure", "ev") !== undefined) s.exposure = p("color.exposure", "ev")!;
  if (p("color.contrast", "amount") !== undefined) s.contrast = p("color.contrast", "amount")!;
  if (p("color.highlightsShadows", "highlights") !== undefined) s.highlights = p("color.highlightsShadows", "highlights")!;
  if (p("color.highlightsShadows", "shadows") !== undefined) s.shadows = p("color.highlightsShadows", "shadows")!;
  if (p("color.blacksWhites", "blacks") !== undefined) s.blacks = p("color.blacksWhites", "blacks")!;
  if (p("color.blacksWhites", "whites") !== undefined) s.whites = p("color.blacksWhites", "whites")!;
  if (p("color.temperature", "temperature") !== undefined) s.temperature = p("color.temperature", "temperature")!;
  if (p("color.temperature", "tint") !== undefined) s.tint = p("color.temperature", "tint")!;
  if (p("color.vibrance", "amount") !== undefined) s.vibrance = p("color.vibrance", "amount")!;
  if (p("color.saturation", "amount") !== undefined) s.saturation = p("color.saturation", "amount")!;
  const w = existing.find((e) => e.type === "color.wheels");
  if (w) {
    const lift = hueAmount(w.params["lift_x"]?.value ?? 0, w.params["lift_y"]?.value ?? 0);
    s.shadowsHue = lift.hue; s.shadowsAmount = lift.amount; s.shadowsLum = w.params["lift_m"]?.value ?? 0;
    const gam = hueAmount(w.params["gamma_x"]?.value ?? 0, w.params["gamma_y"]?.value ?? 0);
    s.midsHue = gam.hue; s.midsAmount = gam.amount; s.midsGamma = w.params["gamma_m"]?.value ?? 1;
    const gain = hueAmount(w.params["gain_x"]?.value ?? 0, w.params["gain_y"]?.value ?? 0);
    s.highsHue = gain.hue; s.highsAmount = gain.amount; s.highsGain = w.params["gain_m"]?.value ?? 1;
  }
  const cv = existing.find((e) => e.type === "color.curves")?.params["curve"]?.string;
  if (cv) { const g = parseGradeCurve(cv); s.master = g.master; s.red = g.red; s.green = g.green; s.blue = g.blue; }
  const hc = existing.find((e) => e.type === "color.hueCurves")?.params["curves"]?.string;
  if (hc) s.hue = parseHueCurves(hc);
  const lut = existing.find((e) => e.type === "color.lut");
  if (lut) { s.lutPath = lut.params["path"]?.string; s.lutIntensity = lut.params["intensity"]?.value ?? 1; }
  return s;
}

export function buildColorStack(existing: Effect[] | undefined, input: ApplyColorInput, newId: () => string): Effect[] {
  const s = input.reset ? neutralState() : decodeState((existing ?? []).filter((e) => e.type.startsWith("color.")));
  if (input.exposure !== undefined) s.exposure = input.exposure;
  if (input.contrast !== undefined) s.contrast = input.contrast;
  if (input.saturation !== undefined) s.saturation = input.saturation;
  if (input.vibrance !== undefined) s.vibrance = input.vibrance;
  if (input.temperature !== undefined) s.temperature = input.temperature;
  if (input.tint !== undefined) s.tint = input.tint;
  if (input.highlights !== undefined) s.highlights = input.highlights;
  if (input.shadows !== undefined) s.shadows = input.shadows;
  if (input.blacks !== undefined) s.blacks = input.blacks;
  if (input.whites !== undefined) s.whites = input.whites;
  if (input.shadowsHue !== undefined) s.shadowsHue = input.shadowsHue;
  if (input.shadowsAmount !== undefined) s.shadowsAmount = input.shadowsAmount;
  if (input.shadowsLum !== undefined) s.shadowsLum = input.shadowsLum;
  if (input.midsHue !== undefined) s.midsHue = input.midsHue;
  if (input.midsAmount !== undefined) s.midsAmount = input.midsAmount;
  if (input.midsGamma !== undefined) s.midsGamma = input.midsGamma;
  if (input.highsHue !== undefined) s.highsHue = input.highsHue;
  if (input.highsAmount !== undefined) s.highsAmount = input.highsAmount;
  if (input.highsGain !== undefined) s.highsGain = input.highsGain;
  if (input.masterCurve) s.master = pts(input.masterCurve);
  if (input.redCurve) s.red = pts(input.redCurve);
  if (input.greenCurve) s.green = pts(input.greenCurve);
  if (input.blueCurve) s.blue = pts(input.blueCurve);
  if (input.hueCurves) s.hue = compileHueCurves(input.hueCurves);
  if (input.lut) {
    if (input.lut.path !== undefined) s.lutPath = input.lut.path;
    if (input.lut.strength !== undefined) s.lutIntensity = input.lut.strength;
  }

  const eff = (type: string, params: Record<string, EffectParam>): Effect => ({ id: newId(), type, enabled: true, params });
  const out: Effect[] = [];
  if (s.exposure !== 0) out.push(eff("color.exposure", { ev: v(s.exposure) }));
  if (s.contrast !== 1) out.push(eff("color.contrast", { amount: v(s.contrast) }));
  if (s.highlights !== 0 || s.shadows !== 0) out.push(eff("color.highlightsShadows", { highlights: v(s.highlights), shadows: v(s.shadows) }));
  if (s.blacks !== 0 || s.whites !== 0) out.push(eff("color.blacksWhites", { blacks: v(s.blacks), whites: v(s.whites) }));
  if (s.temperature !== 6500 || s.tint !== 0) out.push(eff("color.temperature", { temperature: v(s.temperature), tint: v(s.tint) }));
  if (s.vibrance !== 0) out.push(eff("color.vibrance", { amount: v(s.vibrance) }));
  if (s.saturation !== 1) out.push(eff("color.saturation", { amount: v(s.saturation) }));
  const [lx, ly] = xy(s.shadowsHue ?? 0, s.shadowsAmount ?? 0);
  const [gx, gy] = xy(s.midsHue ?? 0, s.midsAmount ?? 0);
  const [nx, ny] = xy(s.highsHue ?? 0, s.highsAmount ?? 0);
  if (lx || ly || s.shadowsLum !== 0 || gx || gy || s.midsGamma !== 1 || nx || ny || s.highsGain !== 1) {
    out.push(eff("color.wheels", {
      lift_x: v(lx), lift_y: v(ly), lift_m: v(s.shadowsLum),
      gamma_x: v(gx), gamma_y: v(gy), gamma_m: v(s.midsGamma),
      gain_x: v(nx), gain_y: v(ny), gain_m: v(s.highsGain),
    }));
  }
  if (s.master.length || s.red.length || s.green.length || s.blue.length) {
    const gc: GradeCurve = { master: s.master, red: s.red, green: s.green, blue: s.blue };
    out.push({ id: newId(), type: "color.curves", enabled: true, params: { curve: { string: JSON.stringify(gc) } } });
  }
  if (s.hue.hueVsHue.length || s.hue.hueVsSat.length || s.hue.hueVsLum.length) {
    out.push({ id: newId(), type: "color.hueCurves", enabled: true, params: { curves: { string: JSON.stringify(s.hue) } } });
  }
  if (s.lutPath) out.push({ id: newId(), type: "color.lut", enabled: true, params: { path: { string: s.lutPath }, intensity: v(s.lutIntensity) } });

  const nonColor = (existing ?? []).filter((e) => !e.type.startsWith("color."));
  return [...out, ...nonColor].sort((a, b) => canonicalIndex(a.type) - canonicalIndex(b.type));
}

export function applyEffectStack(existing: Effect[] | undefined, adds: EffectSpec[], removes: string[], newId: () => string): Effect[] {
  let stack = [...(existing ?? [])];
  for (const t of removes) stack = stack.filter((e) => e.type !== t);
  for (const a of adds) {
    const d = effectDescriptor(a.type);
    if (!d) continue;
    const base = stack.find((e) => e.type === a.type) ?? defaultEffect(a.type, newId)!;
    const effect: Effect = { ...base, enabled: a.enabled ?? base.enabled, params: { ...base.params } };
    if (a.params) {
      for (const spec of d.params) {
        const val = a.params[spec.key];
        if (val !== undefined) {
          const c = Math.max(spec.min, Math.min(spec.max, val));
          effect.params[spec.key] = { value: Math.round(c * 1000) / 1000 };
        }
      }
    }
    stack = stack.filter((e) => e.type !== a.type);
    const idx = stack.findIndex((e) => canonicalIndex(e.type) > canonicalIndex(a.type));
    if (idx === -1) stack.push(effect); else stack.splice(idx, 0, effect);
  }
  return stack;
}

export function scopesGap(c: Scopes, r: Scopes): { deltas: Record<string, number | number[]>; hints: string[] } {
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  const rgb = (a: [number, number, number], b: [number, number, number]): number[] =>
    [r3(a[0]! - b[0]!), r3(a[1]! - b[1]!), r3(a[2]! - b[2]!)];
  const hints: string[] = [];
  const db = c.lumaBlack - r.lumaBlack;
  if (Math.abs(db) > 0.03) hints.push(db > 0 ? "blacks higher than ref → lower 'blacks'" : "blacks lower → raise 'blacks'");
  const dw = c.warmCoolBias - r.warmCoolBias;
  if (Math.abs(dw) > 0.03) hints.push(dw > 0 ? "warmer than ref → cooler 'temperature'" : "cooler → warmer 'temperature'");
  const dg = c.greenMagentaBias - r.greenMagentaBias;
  if (Math.abs(dg) > 0.02) hints.push(dg > 0 ? "greener → 'tint' toward magenta" : "more magenta → 'tint' toward green");
  const dsat = c.saturationMean - r.saturationMean;
  if (Math.abs(dsat) > 0.03) hints.push(dsat > 0 ? "more saturated → lower 'saturation'" : "less saturated → raise 'saturation'");
  return {
    deltas: {
      lumaBlack: r3(db), lumaWhite: r3(c.lumaWhite - r.lumaWhite), lumaMean: r3(c.lumaMean - r.lumaMean),
      warmCool: r3(dw), greenMagenta: r3(dg), saturation: r3(dsat),
      shadowsRGB: rgb(c.shadowRGB, r.shadowRGB), midsRGB: rgb(c.midRGB, r.midRGB), highsRGB: rgb(c.highRGB, r.highRGB),
    },
    hints,
  };
}
