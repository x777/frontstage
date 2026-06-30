import type { Effect } from "./effect.js";

export type EffectCategory = "color" | "detail" | "key" | "blur" | "stylize";
export interface EffectParamSpec { key: string; min: number; max: number; default: number }
export interface EffectDescriptor {
  type: string;
  displayName: string;
  category: EffectCategory;
  params: EffectParamSpec[];
  stringParams?: string[];
  resourceKey?: string;
  linearizes?: boolean;
}

const P = (key: string, min: number, max: number, def: number): EffectParamSpec => ({ key, min, max, default: def });

export const EFFECT_REGISTRY: readonly EffectDescriptor[] = [
  { type: "color.exposure", displayName: "Exposure", category: "color", params: [P("ev", -3, 3, 0)], linearizes: true },
  { type: "color.contrast", displayName: "Contrast", category: "color", params: [P("amount", 0.5, 1.5, 1)] },
  { type: "color.highlightsShadows", displayName: "Highlights & Shadows", category: "color", params: [P("highlights", -1, 1, 0), P("shadows", -1, 1, 0)] },
  { type: "color.blacksWhites", displayName: "Levels", category: "color", params: [P("blacks", -1, 1, 0), P("whites", -1, 1, 0)] },
  { type: "color.temperature", displayName: "Temperature & Tint", category: "color", params: [P("temperature", 2000, 11000, 6500), P("tint", -100, 100, 0)] },
  { type: "color.vibrance", displayName: "Vibrance", category: "color", params: [P("amount", -1, 1, 0)] },
  { type: "color.saturation", displayName: "Saturation", category: "color", params: [P("amount", 0, 2, 1)] },
  { type: "color.wheels", displayName: "Color Wheels", category: "color", params: [
    P("lift_x", -1, 1, 0), P("lift_y", -1, 1, 0), P("lift_m", -0.5, 0.5, 0),
    P("gamma_x", -1, 1, 0), P("gamma_y", -1, 1, 0), P("gamma_m", 0.5, 2, 1),
    P("gain_x", -1, 1, 0), P("gain_y", -1, 1, 0), P("gain_m", 0.5, 1.5, 1),
  ] },
  { type: "color.curves", displayName: "Curves", category: "color", params: [], stringParams: ["curve"] },
  { type: "color.hueCurves", displayName: "Hue Curves", category: "color", params: [], stringParams: ["curves"] },
  { type: "color.lut", displayName: "LUT", category: "color", params: [P("intensity", 0, 1, 1)], stringParams: ["path"], resourceKey: "path" },
  { type: "detail.clarity", displayName: "Clarity & Haze", category: "detail", params: [P("clarity", -1, 1, 0), P("dehaze", -1, 1, 0)] },
  { type: "key.chroma", displayName: "Chroma Key", category: "key", params: [P("keyHue", 0, 1, 0.333), P("tolerance", 0, 1, 0), P("softness", 0, 1, 0.5), P("spill", 0, 1, 0.5)] },
  { type: "blur.gaussian", displayName: "Gaussian Blur", category: "blur", params: [P("radius", 0, 100, 8)] },
  { type: "blur.sharpen", displayName: "Sharpen", category: "blur", params: [P("amount", 0, 2, 0.4)] },
  { type: "blur.noiseReduction", displayName: "Noise Reduction", category: "blur", params: [P("amount", 0, 1, 0)] },
  { type: "blur.motion", displayName: "Motion Blur", category: "blur", params: [P("radius", 0, 100, 0), P("angle", -180, 180, 0)] },
  { type: "stylize.grain", displayName: "Film Grain", category: "stylize", params: [P("amount", 0, 1, 0), P("size", 0.5, 4, 1.5)] },
  { type: "stylize.vignette", displayName: "Vignette", category: "stylize", params: [P("amount", -1, 1, 0), P("midpoint", 0, 1, 0.5), P("roundness", -1, 1, 0), P("feather", 0, 1, 0.5)] },
  { type: "stylize.glow", displayName: "Glow", category: "stylize", params: [P("intensity", 0, 1, 0), P("radius", 0, 100, 20), P("threshold", 0, 1, 0.6), P("warmth", 0, 1, 0)] },
];

const BY_TYPE = new Map(EFFECT_REGISTRY.map((d, i) => [d.type, { d, i }]));

export function effectDescriptor(type: string): EffectDescriptor | undefined {
  return BY_TYPE.get(type)?.d;
}
export function canonicalIndex(type: string): number {
  return BY_TYPE.get(type)?.i ?? -1;
}
export function canonicalSort(effects: Effect[]): Effect[] {
  return effects.map((e, i) => ({ e, i })).sort((a, b) => (canonicalIndex(a.e.type) - canonicalIndex(b.e.type)) || (a.i - b.i)).map((x) => x.e);
}
export function clampParam(type: string, key: string, value: number): number {
  const spec = effectDescriptor(type)?.params.find((p) => p.key === key);
  if (!spec) return value;
  return Math.max(spec.min, Math.min(spec.max, value));
}
export function defaultEffect(type: string, newId: () => string): Effect | null {
  const d = effectDescriptor(type);
  if (!d) return null;
  const params: Record<string, { value: number }> = {};
  for (const p of d.params) params[p.key] = { value: p.default };
  return { id: newId(), type, enabled: true, params };
}
