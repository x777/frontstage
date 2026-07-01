import { describe, it, expect } from "vitest";
import { buildColorStack, applyEffectStack, scopesGap, type ApplyColorInput } from "../src/color/color-tools.js";
import type { Effect } from "../src/color/effect.js";
import type { Scopes } from "../src/color/scopes.js";

let n = 0; const nid = () => `id${n++}`;
const close = (a: number, b: number) => Math.abs(a - b) < 1e-4;

describe("buildColorStack", () => {
  it("emits only the color effects that are set, in canonical order", () => {
    const s = buildColorStack(undefined, { clipIds: [], exposure: 1, saturation: 0.5 }, nid);
    expect(s.map((e) => e.type)).toEqual(["color.exposure", "color.saturation"]);
    expect(s[0]!.params.ev!.value).toBe(1);
    expect(s[1]!.params.amount!.value).toBe(0.5);
  });
  it("emits nothing for a neutral input", () => {
    expect(buildColorStack(undefined, { clipIds: [] }, nid)).toEqual([]);
  });
  it("maps high-level shadow wheel to lift_x/lift_y/lift_m (hue 90 -> +y)", () => {
    const s = buildColorStack(undefined, { clipIds: [], shadowsHue: 90, shadowsAmount: 0.5, shadowsLum: 0.1 }, nid);
    const w = s.find((e) => e.type === "color.wheels")!;
    expect(close(w.params.lift_x!.value!, 0)).toBe(true);
    expect(close(w.params.lift_y!.value!, 0.5)).toBe(true);
    expect(close(w.params.lift_m!.value!, 0.1)).toBe(true);
  });
  it("encodes curves as JSON on color.curves", () => {
    const s = buildColorStack(undefined, { clipIds: [], masterCurve: [[0, 0], [0.5, 0.7], [1, 1]] }, nid);
    const c = s.find((e) => e.type === "color.curves")!;
    expect(JSON.parse(c.params.curve!.string!).master).toEqual([{ x: 0, y: 0 }, { x: 0.5, y: 0.7 }, { x: 1, y: 1 }]);
  });
  it("preserves non-color effects on the clip", () => {
    const existing: Effect[] = [{ id: "g", type: "blur.gaussian", enabled: true, params: { radius: { value: 8 } } }];
    const s = buildColorStack(existing, { clipIds: [], exposure: 1 }, nid);
    expect(s.some((e) => e.type === "blur.gaussian")).toBe(true);
    expect(s.some((e) => e.type === "color.exposure")).toBe(true);
    // canonical order: color.exposure (idx 0) before blur.gaussian (idx 13)
    expect(s.findIndex((e) => e.type === "color.exposure")).toBeLessThan(s.findIndex((e) => e.type === "blur.gaussian"));
  });
  it("reset drops prior color grade", () => {
    const existing: Effect[] = [{ id: "e", type: "color.exposure", enabled: true, params: { ev: { value: 2 } } }];
    const s = buildColorStack(existing, { clipIds: [], reset: true, contrast: 1.2 }, nid);
    expect(s.some((e) => e.type === "color.exposure")).toBe(false);
    expect(s.some((e) => e.type === "color.contrast")).toBe(true);
  });
});

describe("applyEffectStack", () => {
  it("upserts by type carrying existing params, clamps + rounds, canonical insert", () => {
    const existing: Effect[] = [{ id: "v", type: "stylize.vignette", enabled: true, params: { amount: { value: -0.5 } } }];
    const s = applyEffectStack(existing, [{ type: "blur.gaussian", params: { radius: 999 } }], [], nid);
    const g = s.find((e) => e.type === "blur.gaussian")!;
    expect(g.params.radius!.value).toBe(100); // clamped to registry max
    // canonical: blur.gaussian (13) before stylize.vignette (18)
    expect(s.findIndex((e) => e.type === "blur.gaussian")).toBeLessThan(s.findIndex((e) => e.type === "stylize.vignette"));
  });
  it("removes listed types", () => {
    const existing: Effect[] = [{ id: "g", type: "blur.gaussian", enabled: true, params: {} }];
    expect(applyEffectStack(existing, [], ["blur.gaussian"], nid)).toEqual([]);
  });
});

describe("scopesGap", () => {
  const base = (): Scopes => ({ lumaMean: 0.5, lumaBlack: 0.1, lumaWhite: 0.9, clipLow: 0, clipHigh: 0, lumaHistogram: [], meanRGB: [0.5,0.5,0.5], blackRGB: [0,0,0], whiteRGB: [1,1,1], shadowRGB: [0.1,0.1,0.1], midRGB: [0.5,0.5,0.5], highRGB: [0.9,0.9,0.9], saturationMean: 0.3, warmCoolBias: 0, greenMagentaBias: 0, hueHistogram: [], colorfulPct: 0 });
  it("emits hints when a delta exceeds its threshold", () => {
    const cur = { ...base(), lumaBlack: 0.2, warmCoolBias: 0.1 };
    const g = scopesGap(cur, base());
    expect(g.deltas.lumaBlack).toBeCloseTo(0.1, 3);
    expect(g.hints.some((h) => h.includes("blacks"))).toBe(true);
    expect(g.hints.some((h) => h.includes("temperature"))).toBe(true);
  });
  it("no hints when within thresholds", () => {
    expect(scopesGap(base(), base()).hints).toEqual([]);
  });
});
