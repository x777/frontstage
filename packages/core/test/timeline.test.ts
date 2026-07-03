import { describe, expect, test } from "vitest";
import type { Clip } from "../src/clip.js";
import {
  contiguousClipIds,
  defaultTimeline,
  findClip,
  timelineMediaRefs,
  timelineTotalFrames,
  type Track,
} from "../src/timeline.js";
import { defaultTransform, defaultCrop } from "../src/transform.js";

function clip(id: string, startFrame: number, durationFrames: number): Clip {
  return {
    id, mediaRef: "m", mediaType: "video", sourceClipType: "video",
    startFrame, durationFrames, trimStartFrame: 0, trimEndFrame: 0,
    speed: 1, volume: 1, fadeInFrames: 0, fadeOutFrames: 0,
    fadeInInterpolation: "linear", fadeOutInterpolation: "linear",
    opacity: 1, transform: defaultTransform(), crop: defaultCrop(),
  };
}

function track(clips: Clip[]): Track {
  return { id: "t", type: "video", muted: false, hidden: false, syncLocked: true, clips };
}

describe("timeline", () => {
  test("defaults", () => {
    const t = defaultTimeline();
    expect([t.fps, t.width, t.height]).toEqual([30, 1920, 1080]);
  });
  test("totalFrames is max clip end", () => {
    const t = { ...defaultTimeline(), tracks: [track([clip("a", 0, 30), clip("b", 60, 30)])] };
    expect(timelineTotalFrames(t)).toBe(90);
  });
  test("findClip returns location", () => {
    const t = { ...defaultTimeline(), tracks: [track([clip("a", 0, 30)]), track([clip("b", 0, 30)])] };
    expect(findClip(t, "b")).toEqual({ trackIndex: 1, clipIndex: 0 });
    expect(findClip(t, "z")).toBe(null);
  });
  test("contiguousClipIds chains touching clips", () => {
    const tr = track([clip("a", 0, 30), clip("b", 30, 30), clip("c", 90, 30)]);
    expect(contiguousClipIds(tr, 30, "a")).toEqual(new Set(["b"]));
  });
  test("timelineMediaRefs dedupes across tracks in first-appearance order", () => {
    const t = {
      ...defaultTimeline(),
      tracks: [
        track([{ ...clip("a", 0, 30), mediaRef: "m1" }, { ...clip("b", 30, 30), mediaRef: "m2" }]),
        track([{ ...clip("c", 0, 30), mediaRef: "m2" }, { ...clip("d", 30, 30), mediaRef: "m3" }]),
      ],
    };
    expect(timelineMediaRefs(t)).toEqual(["m1", "m2", "m3"]);
  });
  test("timelineMediaRefs on an empty timeline", () => {
    expect(timelineMediaRefs(defaultTimeline())).toEqual([]);
  });
});
