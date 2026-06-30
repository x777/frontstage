import { describe, it, expect } from "vitest";
import { ClipSchema } from "../src/schema/schemas.js";

describe("schema v2 effects/blendMode", () => {
  it("accepts a clip with effects + a non-normal blendMode", () => {
    const base = { id: "c", mediaRef: "m", mediaType: "video", sourceClipType: "video", startFrame: 0, durationFrames: 30, trimStartFrame: 0, trimEndFrame: 0, speed: 1, volume: 1, fadeInFrames: 0, fadeOutFrames: 0, fadeInInterpolation: "linear", fadeOutInterpolation: "linear", opacity: 1, transform: { centerX: 0.5, centerY: 0.5, width: 1, height: 1, rotation: 0, flipHorizontal: false, flipVertical: false }, crop: { top: 0, bottom: 0, left: 0, right: 0 } };
    const withFx = { ...base, blendMode: "multiply", effects: [{ id: "e", type: "color.exposure", enabled: true, params: { ev: { value: 1 } } }] };
    expect(ClipSchema.parse(withFx).effects![0]!.type).toBe("color.exposure");
    // a normal-blend clip omits the key
    expect(ClipSchema.parse(base).blendMode).toBeUndefined();
  });
});
