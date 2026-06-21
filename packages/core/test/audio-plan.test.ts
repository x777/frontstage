import { describe, expect, test } from "vitest";
import type { Clip } from "../src/clip.js";
import { buildAudioPlan } from "../src/audio-plan.js";
import { defaultTimeline, type Track } from "../src/timeline.js";
import { defaultCrop, defaultTransform } from "../src/transform.js";

function clip(over: Partial<Clip> = {}): Clip {
  return {
    id: "c",
    mediaRef: "m",
    mediaType: "audio",
    sourceClipType: "audio",
    startFrame: 0,
    durationFrames: 100,
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
    ...over,
  };
}

const track = (clips: Clip[], over: Partial<Track> = {}): Track =>
  ({
    id: "t",
    type: "audio",
    muted: false,
    hidden: false,
    syncLocked: true,
    clips,
    ...over,
  });

describe("buildAudioPlan", () => {
  test("emits a gain entry per active audio clip", () => {
    const tl = {
      ...defaultTimeline(),
      tracks: [
        track([
          clip({ id: "a1", mediaRef: "ref1", volume: 1.0, startFrame: 0, durationFrames: 100 }),
          clip({ id: "a2", mediaRef: "ref2", volume: 0.5, startFrame: 0, durationFrames: 100 }),
        ]),
      ],
    };
    const plan = buildAudioPlan(tl, 10);
    expect(plan.clips).toHaveLength(2);
    expect(plan.clips.map((c) => c.gain).sort()).toEqual([0.5, 1.0]);
  });

  test("inactive / hidden-track audio clips are excluded", () => {
    const tl = {
      ...defaultTimeline(),
      tracks: [
        track([clip({ id: "a1", startFrame: 0, durationFrames: 100, volume: 1.0 })]),
        track(
          [clip({ id: "a2", startFrame: 0, durationFrames: 100, volume: 0.5 })],
          { hidden: true },
        ),
        track([clip({ id: "a3", startFrame: 50, durationFrames: 20, volume: 0.8 })]),
      ],
    };
    const plan = buildAudioPlan(tl, 10);
    expect(plan.clips).toHaveLength(1);
    expect(plan.clips[0]!.clipId).toBe("a1");
    expect(plan.clips[0]!.gain).toBe(1.0);
  });
});
