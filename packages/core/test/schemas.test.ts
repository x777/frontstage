import { describe, expect, expectTypeOf, test } from "vitest";
import type { z } from "zod";
import type { Timeline } from "../src/timeline.js";
import type { Transform } from "../src/transform.js";
import { TimelineSchema, TransformSchema } from "../src/schema/schemas.js";

describe("schemas", () => {
  test("Timeline parse applies per-field defaults", () => {
    const t = TimelineSchema.parse({ tracks: [] });
    expect([t.fps, t.width, t.height, t.settingsConfigured]).toEqual([30, 1920, 1080, false]);
  });
  test("Clip parse fills defaults for missing optional fields", () => {
    const t = TimelineSchema.parse({
      tracks: [{ type: "video", clips: [{ mediaRef: "m", startFrame: 0, durationFrames: 30 }] }],
    });
    const clip = t.tracks[0]!.clips[0]!;
    expect(clip.speed).toBe(1);
    expect(clip.opacity).toBe(1);
    expect(clip.mediaType).toBe("video");
    expect(typeof clip.id).toBe("string");
  });
  test("legacy Transform x/y migrates to centerX/centerY", () => {
    const parsed = TransformSchema.parse({ x: 0, y: 0, width: 1, height: 1 });
    expect(parsed.centerX).toBeCloseTo(0.5);
    expect(parsed.centerY).toBeCloseTo(0.5);
  });
  test("inferred types match hand-written interfaces", () => {
    expectTypeOf<z.infer<typeof TransformSchema>>().toEqualTypeOf<Transform>();
    expectTypeOf<z.infer<typeof TimelineSchema>>().toEqualTypeOf<Timeline>();
  });
});
