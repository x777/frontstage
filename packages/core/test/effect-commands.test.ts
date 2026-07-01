import { describe, it, expect } from "vitest";
import {
  setEffectParam, setEffectString, setSectionEnabled, resetSection, sharedParamValue, effectParamLabel,
} from "../src/editor/effect-commands.js";
import type { Effect } from "../src/color/effect.js";
import type { Clip } from "../src/clip.js";

let n = 0; const nid = () => `id${n++}`;
const clip = (effects?: Effect[]): Clip => ({ id: "c", mediaType: "video", startFrame: 0, durationFrames: 10, effects } as unknown as Clip);

describe("setEffectParam", () => {
  it("creates the effect at its canonical position when absent", () => {
    const s = setEffectParam(undefined, "color.exposure", "ev", 1.5, nid);
    expect(s).toHaveLength(1);
    expect(s[0]!.type).toBe("color.exposure");
    expect(s[0]!.params.ev!.value).toBe(1.5);
  });
  it("clamps to the registry range", () => {
    const s = setEffectParam(undefined, "color.exposure", "ev", 99, nid);
    expect(s[0]!.params.ev!.value).toBe(3); // exposure max
  });
  it("updates an existing effect without duplicating it", () => {
    const s1 = setEffectParam(undefined, "color.contrast", "amount", 1.2, nid);
    const s2 = setEffectParam(s1, "color.contrast", "amount", 1.4, nid);
    expect(s2.filter((e) => e.type === "color.contrast")).toHaveLength(1);
    expect(s2[0]!.params.amount!.value).toBe(1.4);
  });
  it("keeps canonical order across multiple effects", () => {
    let s = setEffectParam(undefined, "color.saturation", "amount", 1.5, nid); // canonical idx high
    s = setEffectParam(s, "color.exposure", "ev", 1, nid); // canonical idx 0
    expect(s.map((e) => e.type)).toEqual(["color.exposure", "color.saturation"]);
  });
  it("prunes a single-param effect when set back to default", () => {
    let s = setEffectParam(undefined, "color.exposure", "ev", 1, nid);
    s = setEffectParam(s, "color.exposure", "ev", 0, nid); // 0 = default
    expect(s).toEqual([]);
  });
  it("prunes a multi-param effect only when ALL params are default", () => {
    let s = setEffectParam(undefined, "color.highlightsShadows", "highlights", 0.5, nid);
    s = setEffectParam(s, "color.highlightsShadows", "shadows", 0.3, nid);
    s = setEffectParam(s, "color.highlightsShadows", "highlights", 0, nid); // still has shadows=0.3
    expect(s.some((e) => e.type === "color.highlightsShadows")).toBe(true);
    s = setEffectParam(s, "color.highlightsShadows", "shadows", 0, nid); // now both default
    expect(s.some((e) => e.type === "color.highlightsShadows")).toBe(false);
  });
  it("setting an absent effect's param to its default is a no-op", () => {
    const s = setEffectParam(undefined, "color.exposure", "ev", 0, nid);
    expect(s).toEqual([]);
  });
  it("unknown effect type is a no-op", () => {
    const s = setEffectParam(undefined, "color.nope", "x", 1, nid);
    expect(s).toEqual([]);
  });
  it("does not mutate the input array or its effect params", () => {
    const orig: Effect[] = [{ id: "x", type: "color.exposure", enabled: true, params: { ev: { value: 1 } } }];
    const origParams = orig[0]!.params;
    setEffectParam(orig, "color.exposure", "ev", 2, nid);
    expect(orig).toHaveLength(1);
    expect(orig[0]!.params).toBe(origParams); // same nested object, untouched
    expect(orig[0]!.params.ev!.value).toBe(1); // original value preserved
  });
  it("keeps an updated middle effect at its canonical slot (not appended)", () => {
    let s = setEffectParam(undefined, "color.exposure", "ev", 1, nid); // idx 0
    s = setEffectParam(s, "color.highlightsShadows", "highlights", 0.5, nid); // middle
    s = setEffectParam(s, "color.saturation", "amount", 1.5, nid); // high idx
    expect(s.map((e) => e.type)).toEqual(["color.exposure", "color.highlightsShadows", "color.saturation"]);
    s = setEffectParam(s, "color.highlightsShadows", "shadows", 0.3, nid); // update the middle effect
    expect(s.map((e) => e.type)).toEqual(["color.exposure", "color.highlightsShadows", "color.saturation"]);
    expect(s[1]!.params.highlights!.value).toBe(0.5); // prior param carried
    expect(s[1]!.params.shadows!.value).toBe(0.3);
  });
});

describe("setEffectString", () => {
  it("sets a string param and keeps the effect", () => {
    const s = setEffectString(undefined, "color.curves", "curve", JSON.stringify({ master: [{ x: 0, y: 0.2 }] }), nid);
    expect(s.find((e) => e.type === "color.curves")?.params.curve!.string).toContain("0.2");
  });
  it("prunes when the string returns to empty (identity)", () => {
    let s = setEffectString(undefined, "color.curves", "curve", "{\"master\":[]}", nid);
    s = setEffectString(s, "color.curves", "curve", "", nid);
    expect(s.some((e) => e.type === "color.curves")).toBe(false);
  });
});

describe("setSectionEnabled / resetSection", () => {
  const stack = (): Effect[] => [
    { id: "a", type: "color.exposure", enabled: true, params: { ev: { value: 1 } } },
    { id: "b", type: "blur.gaussian", enabled: true, params: { radius: { value: 8 } } },
  ];
  it("setSectionEnabled flips enabled on listed types only", () => {
    const s = setSectionEnabled(stack(), ["color.exposure"], false);
    expect(s.find((e) => e.type === "color.exposure")!.enabled).toBe(false);
    expect(s.find((e) => e.type === "blur.gaussian")!.enabled).toBe(true);
  });
  it("resetSection removes listed types", () => {
    const s = resetSection(stack(), ["blur.gaussian"]);
    expect(s.map((e) => e.type)).toEqual(["color.exposure"]);
  });
});

describe("sharedParamValue", () => {
  it("returns the common value", () => {
    const a = clip([{ id: "1", type: "color.exposure", enabled: true, params: { ev: { value: 1 } } }]);
    const b = clip([{ id: "2", type: "color.exposure", enabled: true, params: { ev: { value: 1 } } }]);
    expect(sharedParamValue([a, b], "color.exposure", "ev")).toBe(1);
  });
  it("returns null when values differ", () => {
    const a = clip([{ id: "1", type: "color.exposure", enabled: true, params: { ev: { value: 1 } } }]);
    const b = clip([{ id: "2", type: "color.exposure", enabled: true, params: { ev: { value: 2 } } }]);
    expect(sharedParamValue([a, b], "color.exposure", "ev")).toBeNull();
  });
  it("falls back to the registry default when a clip lacks the effect", () => {
    const a = clip([{ id: "1", type: "color.exposure", enabled: true, params: { ev: { value: 0 } } }]);
    const b = clip(undefined);
    expect(sharedParamValue([a, b], "color.exposure", "ev")).toBe(0); // both effectively default 0
  });
});

describe("effectParamLabel", () => {
  it("maps known params to human labels", () => {
    expect(effectParamLabel("color.exposure", "ev")).toBe("Exposure");
    expect(effectParamLabel("color.temperature", "temperature")).toBe("Temperature");
    expect(effectParamLabel("key.chroma", "keyHue")).toBe("Key Hue");
  });
  it("falls back to the key for unmapped params", () => {
    expect(effectParamLabel("color.zzz", "weird")).toBe("weird");
  });
});
