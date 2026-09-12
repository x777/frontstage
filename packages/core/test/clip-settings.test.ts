import { describe, expect, test } from "vitest";
import {
  applyClipSettings,
  applyingStaticSettings,
  defaultCrop,
  defaultTimeline,
  defaultTransform,
  type Clip,
  type Timeline,
  type Track,
} from "../src/index.js";

function clip(id: string, extra: Partial<Clip> = {}): Clip {
  return {
    id,
    mediaRef: "m",
    mediaType: "video",
    sourceClipType: "video",
    startFrame: 0,
    durationFrames: 60,
    trimStartFrame: 0,
    trimEndFrame: 0,
    speed: 1,
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    fadeInInterpolation: "linear",
    fadeOutInterpolation: "linear",
    opacity: 1,
    transform: defaultTransform(),
    crop: defaultCrop(),
    ...extra,
  };
}

function timeline(clips: Clip[], type: Track["type"] = "video"): Timeline {
  return {
    ...defaultTimeline(),
    tracks: [{ id: "t", type, muted: false, hidden: false, syncLocked: false, clips }],
  };
}

describe("applyingStaticSettings", () => {
  test("video copies transform, crop, opacity, blend, and effects; keeps timing", () => {
    const source = clip("s", {
      opacity: 0.4,
      transform: { ...defaultTransform(), centerX: 0.2, rotation: 12 },
      crop: { left: 0.1, top: 0, right: 0.1, bottom: 0 },
      blendMode: "multiply",
      effects: [{ id: "e1", type: "color.exposure", enabled: true, params: { ev: { value: 1, track: { keyframes: [{ frame: 0, value: 2, interpolationOut: "linear" }] } } } }],
    });
    const target = clip("t", {
      startFrame: 90,
      durationFrames: 30,
      fadeOutFrames: 6,
      opacityTrack: { keyframes: [{ frame: 0, value: 1, interpolationOut: "smooth" }] },
    });
    const next = applyingStaticSettings(source, target);
    expect(next.startFrame).toBe(90);
    expect(next.durationFrames).toBe(30);
    expect(next.fadeOutFrames).toBe(6);
    expect(next.opacityTrack).toEqual(target.opacityTrack);
    expect(next.opacity).toBe(0.4);
    expect(next.transform).toEqual(source.transform);
    expect(next.crop).toEqual(source.crop);
    expect(next.blendMode).toBe("multiply");
    expect(next.effects![0]!.params.ev!.track).toBeUndefined();
    expect(next.effects![0]!.params.ev!.value).toBe(1);
  });

  test("text copies style/fill/animation/position but not content, words, or box size", () => {
    const source = clip("s", {
      mediaType: "text",
      sourceClipType: "text",
      opacity: 0.65,
      textContent: "Title",
      textStyle: {
        fontName: "Avenir",
        fontSize: 48,
        fontScale: 1,
        color: { r: 1, g: 1, b: 1, a: 1 },
        alignment: "center",
        shadow: { enabled: true, color: { r: 0, g: 0, b: 0, a: 0.6 }, offsetX: 0, offsetY: -2, blur: 6 },
        background: { enabled: false, color: { r: 0, g: 0, b: 0, a: 0.6 } },
        border: { enabled: false, color: { r: 0, g: 0, b: 0, a: 1 } },
      },
      textAnimation: { preset: "wordSlide" },
      textFillMode: "footage",
      transform: { ...defaultTransform(), centerX: 0.2, centerY: 0.8, rotation: -8, width: 1 },
      effects: [{ id: "inv", type: "stylize.invert", enabled: true, params: {} }],
    });
    const target = clip("t", {
      mediaType: "text",
      sourceClipType: "text",
      startFrame: 90,
      durationFrames: 120,
      textContent: "A much longer target title",
      wordTimings: [{ text: "A", startFrame: 0, endFrame: 10 }],
      captionGroupId: "captions",
      opacityTrack: { keyframes: [{ frame: 20, value: 0.5, interpolationOut: "smooth" }] },
      transform: { ...defaultTransform(), width: 0.4, height: 0.2 },
      effects: [{ id: "blur", type: "blur.gaussian", enabled: true, params: { radius: { value: 4 } } }],
    });
    const next = applyingStaticSettings(source, target);
    expect(next.textContent).toBe(target.textContent);
    expect(next.wordTimings).toEqual(target.wordTimings);
    expect(next.captionGroupId).toBe("captions");
    expect(next.durationFrames).toBe(120);
    expect(next.opacityTrack).toEqual(target.opacityTrack);
    expect(next.textStyle).toEqual(source.textStyle);
    expect(next.textAnimation).toEqual(source.textAnimation);
    expect(next.textFillMode).toBe("footage");
    expect(next.opacity).toBe(0.65);
    expect(next.transform.centerX).toBe(0.2);
    expect(next.transform.centerY).toBe(0.8);
    expect(next.transform.rotation).toBe(-8);
    expect(next.transform.width).toBe(0.4);
    expect(next.transform.height).toBe(0.2);
    expect(next.effects?.map((e) => e.type)).toEqual(["stylize.invert", "blur.gaussian"]);
  });

  test("audio copies volume and effects only", () => {
    const source = clip("s", {
      mediaType: "audio",
      sourceClipType: "audio",
      volume: 0.35,
      effects: [{ id: "d", type: "audio.denoise", enabled: true, params: { amount: { value: 0.75 } } }],
    });
    const target = clip("t", {
      mediaType: "audio",
      sourceClipType: "audio",
      startFrame: 70,
      durationFrames: 30,
      volume: 1,
      fadeOutFrames: 8,
      volumeTrack: { keyframes: [{ frame: 5, value: 0.2, interpolationOut: "linear" }] },
    });
    const next = applyingStaticSettings(source, target);
    expect(next.volume).toBe(0.35);
    expect(next.effects).toEqual(source.effects);
    expect(next.fadeOutFrames).toBe(8);
    expect(next.volumeTrack).toEqual(target.volumeTrack);
    expect(next.startFrame).toBe(70);
  });
});

describe("applyClipSettings", () => {
  test("refuses mismatched media types and empty targets", () => {
    const tl = timeline([clip("s"), clip("a", { mediaType: "audio", sourceClipType: "audio" })]);
    expect(applyClipSettings(tl, "s", []).ok).toBe(false);
    expect(applyClipSettings(tl, "s", ["a"]).ok).toBe(false);
    expect(applyClipSettings(tl, "missing", ["s"]).ok).toBe(false);
  });

  test("rewrites only changed clips and reports unchanged", () => {
    const tl = timeline([
      clip("s", { opacity: 0.5 }),
      clip("t1", { startFrame: 60, opacity: 1 }),
      clip("t2", { startFrame: 120, opacity: 0.5, transform: { ...defaultTransform() } }),
    ]);
    // t2 already matches source statics (opacity 0.5, default transform)
    const out = applyClipSettings(tl, "s", ["t1", "t2"]);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.changedClipIds).toEqual(["t1"]);
    expect(out.result.unchangedClipIds).toEqual(["t2"]);
    expect(out.timeline.tracks[0]!.clips.find((c) => c.id === "t1")!.opacity).toBe(0.5);
    expect(out.timeline.tracks[0]!.clips.find((c) => c.id === "t1")!.startFrame).toBe(60);
  });
});
