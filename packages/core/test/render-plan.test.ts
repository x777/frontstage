import { describe, expect, test } from "vitest";
import type { Clip } from "../src/clip.js";
import { applyTextLayerAnim, buildRenderPlan, type TextLayer } from "../src/render-plan.js";
import { defaultTimeline, type Track } from "../src/timeline.js";
import { defaultCrop, defaultTransform } from "../src/transform.js";
import { defaultTextStyle } from "../src/text-style.js";
import type { Effect } from "../src/color/effect.js";
import type { BlendMode } from "../src/color/blend-mode.js";
import type { TextWordTiming } from "../src/text-animation.js";

function clip(over: Partial<Clip> = {}): Clip {
  return {
    id: "c", mediaRef: "m", mediaType: "video", sourceClipType: "video",
    startFrame: 0, durationFrames: 100, trimStartFrame: 0, trimEndFrame: 0,
    speed: 1, volume: 1, fadeInFrames: 0, fadeOutFrames: 0,
    fadeInInterpolation: "linear", fadeOutInterpolation: "linear",
    opacity: 1, transform: defaultTransform(), crop: defaultCrop(), ...over,
  };
}
const track = (clips: Clip[], over: Partial<Track> = {}): Track =>
  ({ id: "t", type: "video", muted: false, hidden: false, syncLocked: true, clips, ...over });

const sizes = new Map([["m", { width: 1920, height: 1080 }]]);

describe("buildRenderPlan", () => {
  test("single visible video clip yields one layer at zIndex 0", () => {
    const tl = { ...defaultTimeline(), tracks: [track([clip()])] };
    const plan = buildRenderPlan(tl, 10, sizes);
    expect(plan.layers).toHaveLength(1);
    expect(plan.layers[0]!.clipId).toBe("c");
    expect(plan.layers[0]!.zIndex).toBe(0);
    expect(plan.layers[0]!.opacity).toBe(1);
    expect(plan.layers[0]!.mediaRef).toBe("m");
    expect(plan.layers[0]!.transform).toMatchObject({ a: expect.any(Number), e: expect.any(Number) });
  });
  test("frame outside the clip yields no layers", () => {
    const tl = { ...defaultTimeline(), tracks: [track([clip({ startFrame: 0, durationFrames: 5 })])] };
    expect(buildRenderPlan(tl, 50, sizes).layers).toHaveLength(0);
  });
  test("audio clips are excluded", () => {
    const tl = { ...defaultTimeline(), tracks: [track([clip({ id: "a", mediaType: "audio" })], { type: "audio" })] };
    expect(buildRenderPlan(tl, 10, sizes).layers).toHaveLength(0);
  });
  test("hidden tracks are excluded", () => {
    const tl = { ...defaultTimeline(), tracks: [track([clip({ id: "v" })], { hidden: true })] };
    expect(buildRenderPlan(tl, 10, sizes).layers).toHaveLength(0);
  });
  test("buildRenderPlan emits a textLayer for a visible text clip", () => {
    const textClip = clip({
      id: "t",
      mediaType: "text",
      sourceClipType: "text",
      textContent: "Hi",
      textStyle: defaultTextStyle(),
    });
    const tl = { ...defaultTimeline(), tracks: [track([textClip])] };
    const plan = buildRenderPlan(tl, 10, sizes);
    expect(plan.textLayers).toHaveLength(1);
    expect(plan.layers).toHaveLength(0);
    const t = plan.textLayers[0]!;
    expect(t.text).toBe("Hi");
    expect(t.zIndex).toBe(0);
    expect(t.opacity).toBeGreaterThan(0);
    expect(t.clipId).toBe("t");
  });
  test("text clip on a hidden track emits no textLayer", () => {
    const textClip = clip({
      id: "t",
      mediaType: "text",
      sourceClipType: "text",
      textContent: "Hi",
      textStyle: defaultTextStyle(),
    });
    const tl = { ...defaultTimeline(), tracks: [track([textClip], { hidden: true })] };
    const plan = buildRenderPlan(tl, 10, sizes);
    expect(plan.textLayers).toHaveLength(0);
  });
  test("text clip with empty text emits no textLayer", () => {
    const textClip = clip({
      id: "t",
      mediaType: "text",
      sourceClipType: "text",
      textContent: "",
      textStyle: defaultTextStyle(),
    });
    const tl = { ...defaultTimeline(), tracks: [track([textClip])] };
    const plan = buildRenderPlan(tl, 10, sizes);
    expect(plan.textLayers).toHaveLength(0);
  });
});

describe("buildRenderPlan effects/blendMode propagation (M9B-1)", () => {
  function makeTimelineWithClip(opts: { startFrame: number; durationFrames: number; effects?: Effect[]; blendMode?: BlendMode }) {
    const c = clip({ startFrame: opts.startFrame, durationFrames: opts.durationFrames, effects: opts.effects, blendMode: opts.blendMode });
    return { ...defaultTimeline(), tracks: [track([c])] };
  }
  const sm = new Map([["m", { width: 100, height: 100 }]]);

  test("carries a clip's effects and blendMode onto its RenderLayer", () => {
    const effects = [{ id: "e", type: "color.saturation", enabled: true, params: { amount: { value: 0 } } }];
    const tl = makeTimelineWithClip({ startFrame: 0, durationFrames: 30, effects, blendMode: "multiply" });
    const { layers } = buildRenderPlan(tl, 5, sm);
    expect(layers).toHaveLength(1);
    expect(layers[0]!.blendMode).toBe("multiply");
    expect(layers[0]!.effects).toEqual(effects);
  });

  test("leaves effects/blendMode undefined for a clip without them", () => {
    const tl = makeTimelineWithClip({ startFrame: 0, durationFrames: 30 });
    const { layers } = buildRenderPlan(tl, 5, sm);
    expect(layers[0]!.effects).toBeUndefined();
    expect(layers[0]!.blendMode).toBeUndefined();
  });
});

describe("buildRenderPlan text-animation threading (M11C T2)", () => {
  const timings3: TextWordTiming[] = [
    { text: "ONE", startFrame: 0, endFrame: 10 },
    { text: "TWO", startFrame: 10, endFrame: 20 },
    { text: "THREE", startFrame: 20, endFrame: 30 },
  ];
  function animClip(over: Partial<Clip> = {}): Clip {
    return clip({
      id: "t", mediaType: "text", sourceClipType: "text",
      textContent: "ONE TWO THREE", textStyle: defaultTextStyle(),
      durationFrames: 40, ...over,
    });
  }

  test("a clip with no textAnimation gets no wordState/layerAnim/preset (byte-identical to pre-M11C)", () => {
    const tl = { ...defaultTimeline(), tracks: [track([animClip()])] };
    const t = buildRenderPlan(tl, 5, sizes).textLayers[0]!;
    expect(t.preset).toBeUndefined();
    expect(t.wordState).toBeUndefined();
    expect(t.layerAnim).toBeUndefined();
  });

  test('preset "none" also gets no wordState/layerAnim', () => {
    const tl = {
      ...defaultTimeline(),
      tracks: [track([animClip({ textAnimation: { preset: "none" } })])],
    };
    const t = buildRenderPlan(tl, 5, sizes).textLayers[0]!;
    expect(t.wordState).toBeUndefined();
    expect(t.layerAnim).toBeUndefined();
  });

  test("wordReveal with aligned wordTimings computes wordState at the clip-relative frame", () => {
    const tl = {
      ...defaultTimeline(),
      tracks: [track([animClip({
        startFrame: 100,
        textAnimation: { preset: "wordReveal" },
        wordTimings: timings3,
      })])],
    };
    // frame 105 -> clipFrame 5 -> only word 0's startFrame(0) is passed
    const t = buildRenderPlan(tl, 105, sizes).textLayers[0]!;
    expect(t.preset).toBe("wordReveal");
    expect(t.wordState).toEqual({ visibleCount: 1, highlightIndex: null, soloIndex: null });
  });

  test("wordTimings length mismatch falls back to the static raster (wordState undefined, no crash)", () => {
    const tl = {
      ...defaultTimeline(),
      tracks: [track([animClip({
        textAnimation: { preset: "wordReveal" },
        wordTimings: [{ text: "ONE", startFrame: 0, endFrame: 10 }], // 1 timing, 3 words
      })])],
    };
    const t = buildRenderPlan(tl, 5, sizes).textLayers[0]!;
    expect(t.preset).toBe("wordReveal");
    expect(t.wordState).toBeUndefined();
  });

  test("a word preset with no wordTimings at all falls back to the static raster", () => {
    const tl = {
      ...defaultTimeline(),
      tracks: [track([animClip({ textAnimation: { preset: "highlightPop" } })])],
    };
    const t = buildRenderPlan(tl, 5, sizes).textLayers[0]!;
    expect(t.wordState).toBeUndefined();
  });

  test("fadeIn computes a non-identity layerAnim mid-ramp and no wordState (entrance preset)", () => {
    const tl = {
      ...defaultTimeline(),
      tracks: [track([animClip({ textAnimation: { preset: "fadeIn" } })])],
    };
    // frame 3 is mid the 6-frame ramp (PER_WORD_FRAMES)
    const t = buildRenderPlan(tl, 3, sizes).textLayers[0]!;
    expect(t.wordState).toBeUndefined();
    expect(t.layerAnim).toBeDefined();
    expect(t.layerAnim!.opacity).toBeGreaterThan(0);
    expect(t.layerAnim!.opacity).toBeLessThan(1);
  });
});

describe("applyTextLayerAnim", () => {
  const baseTransform = defaultTransform();
  function layer(over: Partial<TextLayer> = {}): TextLayer {
    return { clipId: "t", text: "hi", style: defaultTextStyle(), transform: baseTransform, opacity: 1, zIndex: 0, ...over };
  }

  test("no layerAnim passes transform/opacity through unchanged", () => {
    const l = layer();
    const r = applyTextLayerAnim(l);
    expect(r.transform).toEqual(baseTransform);
    expect(r.opacity).toBe(1);
  });

  test("multiplies opacity and scales width/height around the transform's own center", () => {
    const l = layer({ opacity: 0.8, layerAnim: { opacity: 0.5, scale: 0.6, offsetY: 0.1 } });
    const r = applyTextLayerAnim(l);
    expect(r.opacity).toBeCloseTo(0.4); // 0.8 * 0.5
    expect(r.transform.width).toBeCloseTo(baseTransform.width * 0.6);
    expect(r.transform.height).toBeCloseTo(baseTransform.height * 0.6);
    expect(r.transform.centerX).toBe(baseTransform.centerX); // scale is centered — centerX untouched
    expect(r.transform.centerY).toBeCloseTo(baseTransform.centerY + 0.1); // offsetY adds directly
  });

  test("identity layerAnim (word presets) is a no-op", () => {
    const l = layer({ layerAnim: { opacity: 1, scale: 1, offsetY: 0 } });
    const r = applyTextLayerAnim(l);
    expect(r.transform).toEqual(baseTransform);
    expect(r.opacity).toBe(1);
  });
});
