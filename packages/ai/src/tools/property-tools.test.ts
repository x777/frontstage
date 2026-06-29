import { describe, it, expect } from "vitest";
import { setClipPropertiesTool, setKeyframesTool } from "./property-tools.js";

// Tier 0: tool numeric args must reject NaN/Infinity before they can corrupt the timeline.
describe("property-tools numeric hardening (Tier 0)", () => {
  const transform = (centerX: number) => ({
    centerX,
    centerY: 0.5,
    width: 1,
    height: 1,
    rotation: 0,
    flipHorizontal: false,
    flipVertical: false,
  });

  it("set_clip_properties rejects NaN and Infinity in transform", () => {
    const schema = setClipPropertiesTool().inputSchema;
    expect(schema.safeParse({ clipId: "c", properties: { transform: transform(NaN) } }).success).toBe(false);
    expect(schema.safeParse({ clipId: "c", properties: { transform: transform(Infinity) } }).success).toBe(false);
  });

  it("set_clip_properties accepts a finite transform", () => {
    const schema = setClipPropertiesTool().inputSchema;
    expect(schema.safeParse({ clipId: "c", properties: { transform: transform(0.5) } }).success).toBe(true);
  });

  it("set_keyframes rejects a NaN crop keyframe value", () => {
    const schema = setKeyframesTool().inputSchema;
    const bad = schema.safeParse({
      clipId: "c",
      trackKey: "cropTrack",
      keyframes: [{ frame: 0, value: { top: NaN, bottom: 0, left: 0, right: 0 } }],
    });
    expect(bad.success).toBe(false);
  });
});
