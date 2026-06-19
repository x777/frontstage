import { describe, expect, test } from "vitest";
import { fitTransform } from "../src/fit-transform.js";

describe("fitTransform", () => {
  test("matching aspect → identity (full canvas)", () => {
    const t = fitTransform({ width: 1920, height: 1080 }, { width: 1280, height: 720 });
    expect(t.width).toBe(1);
    expect(t.height).toBe(1);
  });
  test("wide source in tall canvas → full width, reduced height (letterbox)", () => {
    // 16:9 source (aspect 1.778) in a 1:1 canvas (aspect 1.0): sourceAspect > canvasAspect
    const t = fitTransform({ width: 1920, height: 1080 }, { width: 1000, height: 1000 });
    expect(t.width).toBe(1);
    expect(t.height).toBeCloseTo(1.0 / (1920 / 1080)); // canvasAspect / sourceAspect
  });
  test("tall source in wide canvas → full height, reduced width (pillarbox)", () => {
    // 9:16 source (0.5625) in 16:9 canvas (1.778): sourceAspect < canvasAspect
    const t = fitTransform({ width: 1080, height: 1920 }, { width: 1920, height: 1080 });
    expect(t.height).toBe(1);
    expect(t.width).toBeCloseTo((1080 / 1920) / (1920 / 1080)); // sourceAspect / canvasAspect
  });
  test("invalid sizes → identity", () => {
    const t = fitTransform({ width: 0, height: 0 }, { width: 100, height: 100 });
    expect(t.width).toBe(1);
    expect(t.height).toBe(1);
    expect(t.centerX).toBe(0.5);
    expect(t.centerY).toBe(0.5);
  });
  test("zero canvas dimensions → identity (no Infinity)", () => {
    const t = fitTransform({ width: 1920, height: 1080 }, { width: 0, height: 0 });
    expect(t.width).toBe(1);
    expect(t.height).toBe(1);
  });
});
