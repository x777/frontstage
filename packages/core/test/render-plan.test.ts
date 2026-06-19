import { describe, expect, test } from "vitest";
import type { Clip } from "../src/clip.js";
import { buildRenderPlan } from "../src/render-plan.js";
import { defaultTimeline, type Track } from "../src/timeline.js";
import { defaultCrop, defaultTransform } from "../src/transform.js";

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
  });
  test("frame outside the clip yields no layers", () => {
    const tl = { ...defaultTimeline(), tracks: [track([clip({ startFrame: 0, durationFrames: 5 })])] };
    expect(buildRenderPlan(tl, 50, sizes).layers).toHaveLength(0);
  });
  test("audio clips and hidden tracks are excluded", () => {
    const tl = {
      ...defaultTimeline(),
      tracks: [
        track([clip({ id: "a", mediaType: "audio" })], { type: "audio" }),
        track([clip({ id: "v" })], { hidden: true }),
      ],
    };
    expect(buildRenderPlan(tl, 10, sizes).layers).toHaveLength(0);
  });
});
