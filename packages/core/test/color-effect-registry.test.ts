import { describe, it, expect } from "vitest";
import { EFFECT_REGISTRY, effectDescriptor, defaultEffect, canonicalIndex, canonicalSort, clampParam } from "../src/color/effect-registry.js";
import { resolveParam, type Effect } from "../src/color/effect.js";
import { BLEND_MODES } from "../src/color/blend-mode.js";

describe("effect registry", () => {
  it("declares all 20 effects in canonical order", () => {
    expect(EFFECT_REGISTRY).toHaveLength(20);
    expect(EFFECT_REGISTRY[0]!.type).toBe("color.exposure");
    expect(EFFECT_REGISTRY[19]!.type).toBe("stylize.glow");
    EFFECT_REGISTRY.forEach((d, i) => expect(canonicalIndex(d.type)).toBe(i));
  });
  it("marks color.exposure as the only linearizing effect", () => {
    expect(effectDescriptor("color.exposure")!.linearizes).toBe(true);
    expect(effectDescriptor("color.contrast")!.linearizes).toBeFalsy();
  });
  it("records the LUT resourceKey", () => {
    expect(effectDescriptor("color.lut")!.resourceKey).toBe("path");
    expect(effectDescriptor("color.lut")!.stringParams).toContain("path");
  });
  it("defaultEffect builds every numeric param at its default", () => {
    let n = 0;
    const e = defaultEffect("color.wheels", () => `id${n++}`)!;
    expect(e.type).toBe("color.wheels");
    expect(e.enabled).toBe(true);
    expect(e.params.gamma_m!.value).toBe(1);
    expect(e.params.lift_x!.value).toBe(0);
    expect(defaultEffect("nope.bad", () => "x")).toBeNull();
  });
  it("clampParam clamps to the registered range", () => {
    expect(clampParam("color.exposure", "ev", 99)).toBe(3);
    expect(clampParam("color.exposure", "ev", -99)).toBe(-3);
    expect(clampParam("color.exposure", "ev", 1)).toBe(1);
  });
  it("canonicalSort orders an arbitrary effects array by render precedence", () => {
    const fx: Effect[] = [
      { id: "a", type: "stylize.glow", enabled: true, params: {} },
      { id: "b", type: "color.exposure", enabled: true, params: {} },
    ];
    expect(canonicalSort(fx).map((e) => e.type)).toEqual(["color.exposure", "stylize.glow"]);
  });
});

describe("resolveParam", () => {
  it("returns value when no track, fallback when absent", () => {
    expect(resolveParam({ value: 2 }, 0, 5)).toBe(2);
    expect(resolveParam(undefined, 0, 5)).toBe(5);
  });
  it("samples an active track, else falls through to value", () => {
    const active = { value: 1, track: { keyframes: [{ frame: 0, value: 10, interpolationOut: "hold" as const }, { frame: 10, value: 20, interpolationOut: "hold" as const }] } };
    expect(resolveParam(active, 0, 0)).toBe(10);
    const inactive = { value: 7, track: { keyframes: [] } };
    expect(resolveParam(inactive, 0, 0)).toBe(7);
  });
});

describe("blend modes", () => {
  it("lists the 16 modes with normal first", () => {
    expect(BLEND_MODES).toHaveLength(16);
    expect(BLEND_MODES[0]).toBe("normal");
    expect(BLEND_MODES).toContain("luminosity");
  });
});
