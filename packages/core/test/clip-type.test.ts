import { describe, expect, test } from "vitest";
import { clipTypeFromFileExtension, clipTypesCompatible, clipTypeIsVisual } from "../src/clip-type.js";

describe("clip type", () => {
  test("visual types", () => {
    expect(clipTypeIsVisual("video")).toBe(true);
    expect(clipTypeIsVisual("sequence")).toBe(true);
    expect(clipTypeIsVisual("audio")).toBe(false);
  });
  test("compatibility: any two visuals compatible, audio only with audio", () => {
    expect(clipTypesCompatible("video", "image")).toBe(true);
    expect(clipTypesCompatible("video", "sequence")).toBe(true);
    expect(clipTypesCompatible("audio", "video")).toBe(false);
    expect(clipTypesCompatible("audio", "audio")).toBe(true);
  });
  test("file extension mapping", () => {
    expect(clipTypeFromFileExtension("mp4")).toBe("video");
    expect(clipTypeFromFileExtension("webp")).toBe("image");
    expect(clipTypeFromFileExtension("lottie")).toBe("lottie");
    expect(clipTypeFromFileExtension("srt")).toBe("subtitle");
    expect(clipTypeFromFileExtension("VTT")).toBe("subtitle");
    expect(clipTypeFromFileExtension("xyz")).toBe(null);
  });
});
