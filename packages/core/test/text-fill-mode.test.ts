import { describe, expect, test } from "vitest";
import {
  applyFootageStencil,
  applyTextFillMode,
  DEFAULT_FOOTAGE_MATTE_COLOR,
  defaultCrop,
  defaultTextStyle,
  defaultTransform,
  textRasterAppearance,
  type Clip,
} from "../src/index.js";

function textClip(over: Partial<Clip> = {}): Clip {
  return {
    id: "t",
    mediaRef: "text",
    mediaType: "text",
    sourceClipType: "text",
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
    textContent: "Hi",
    textStyle: defaultTextStyle(),
    ...over,
  };
}

describe("text fillMode / raster appearance", () => {
  test("footage without color uses the black matte", () => {
    const next = applyTextFillMode(textClip(), "footage");
    expect(next.textFillMode).toBe("footage");
    expect(next.textStyle?.color).toEqual(DEFAULT_FOOTAGE_MATTE_COLOR);
  });

  test("footage with explicit color keeps it", () => {
    const green = { r: 0, g: 1, b: 0, a: 1 };
    const next = applyTextFillMode(textClip(), "footage", green);
    expect(next.textFillMode).toBe("footage");
    expect(next.textStyle?.color).toEqual(green);
  });

  test("inverted stores the mode; color clears it", () => {
    const inv = applyTextFillMode(textClip(), "inverted");
    expect(inv.textFillMode).toBe("inverted");
    expect(applyTextFillMode(inv, "color").textFillMode).toBeUndefined();
  });

  test("raster appearance reads scale/blur and inverted blend", () => {
    const style = { ...defaultTextStyle(), widthScale: 2, heightScale: 0.5, blur: 10.8 };
    const inv = textRasterAppearance(style, "inverted", 1080);
    expect(inv.fill).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expect(inv.drawShadow).toBe(false);
    expect(inv.blendMode).toBe("difference");
    expect(inv.widthScale).toBe(2);
    expect(inv.heightScale).toBe(0.5);
    expect(inv.blurPx).toBeCloseTo(10.8);
    const footage = textRasterAppearance(style, "footage", 2160);
    expect(footage.stencil).toBe(true);
    expect(footage.fill).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expect(footage.matte).toEqual(style.color);
    expect(footage.blurPx).toBeCloseTo(21.6);
  });

  test("footage stencil keeps dest through the glyph and shows matte outside", () => {
    const dest = { r: 1, g: 0, b: 0 };
    const matte = { r: 0, g: 0, b: 0, a: 1 };
    expect(applyFootageStencil(dest, 1, matte)).toEqual(dest);
    expect(applyFootageStencil(dest, 0, matte)).toEqual({ r: 0, g: 0, b: 0 });
    const faded = applyFootageStencil(dest, 0, matte, 0.5);
    expect(faded.r).toBeCloseTo(0.5);
  });
});
