import { describe, it, expect } from "vitest";
import type { Clip } from "../clip.js";
import { mergeRanges, computeRippleShiftsForRanges, computeRippleShifts, computeRipplePush } from "./ripple-engine.js";

// Minimal Clip factory — only the fields the ripple math reads matter; the rest are defaults.
function clip(id: string, startFrame: number, durationFrames: number): Clip {
  return {
    id, mediaRef: "m", mediaType: "video", sourceClipType: "video",
    startFrame, durationFrames, trimStartFrame: 0, trimEndFrame: 0,
    speed: 1, volume: 1, fadeInFrames: 0, fadeOutFrames: 0,
    fadeInInterpolation: "linear", fadeOutInterpolation: "linear", opacity: 1,
    transform: { centerX: 0.5, centerY: 0.5, width: 1, height: 1, rotation: 0, flipHorizontal: false, flipVertical: false },
    crop: { top: 0, bottom: 0, left: 0, right: 0 },
  };
}

describe("mergeRanges", () => {
  it("merges overlapping and adjacent ranges, keeps disjoint", () => {
    expect(mergeRanges([{ start: 0, end: 10 }, { start: 5, end: 15 }])).toEqual([{ start: 0, end: 15 }]);
    expect(mergeRanges([{ start: 0, end: 10 }, { start: 10, end: 20 }])).toEqual([{ start: 0, end: 20 }]); // adjacent (start <= last.end)
    expect(mergeRanges([{ start: 0, end: 5 }, { start: 10, end: 15 }])).toEqual([{ start: 0, end: 5 }, { start: 10, end: 15 }]);
  });

  it("sorts before merging and handles empty", () => {
    expect(mergeRanges([{ start: 10, end: 15 }, { start: 0, end: 5 }])).toEqual([{ start: 0, end: 5 }, { start: 10, end: 15 }]);
    expect(mergeRanges([])).toEqual([]);
  });
});

describe("computeRippleShiftsForRanges", () => {
  it("shifts a clip left by the total length of ranges ending at or before it", () => {
    const clips = [clip("a", 100, 30)]; // removed range [0,40)
    expect(computeRippleShiftsForRanges(clips, [{ start: 0, end: 40 }])).toEqual([{ clipId: "a", newStartFrame: 60 }]);
  });

  it("does not shift a clip that starts before the removed range", () => {
    const clips = [clip("a", 10, 30)];
    expect(computeRippleShiftsForRanges(clips, [{ start: 100, end: 140 }])).toEqual([]);
  });

  it("sums multiple ranges and only counts ranges with end <= clip.startFrame", () => {
    const clips = [clip("a", 200, 10)];
    const shifts = computeRippleShiftsForRanges(clips, [{ start: 0, end: 20 }, { start: 50, end: 80 }, { start: 210, end: 220 }]);
    expect(shifts).toEqual([{ clipId: "a", newStartFrame: 200 - (20 + 30) }]); // 50 total, range [210,220) excluded
  });

  it("returns [] for no removed ranges", () => {
    expect(computeRippleShiftsForRanges([clip("a", 100, 10)], [])).toEqual([]);
  });
});

describe("computeRippleShifts", () => {
  it("derives removed ranges from removedIds and shifts survivors", () => {
    const clips = [clip("gone", 0, 40), clip("a", 100, 30)];
    expect(computeRippleShifts(clips, new Set(["gone"]))).toEqual([{ clipId: "a", newStartFrame: 60 }]);
  });
});

describe("computeRipplePush", () => {
  it("pushes clips at or after insertFrame, skipping excluded ids", () => {
    const clips = [clip("before", 0, 10), clip("at", 50, 10), clip("after", 80, 10)];
    expect(computeRipplePush(clips, 50, 100, new Set(["at"]))).toEqual([{ clipId: "after", newStartFrame: 180 }]);
  });

  it("pushes everything when no exclusions", () => {
    const clips = [clip("at", 50, 10), clip("after", 80, 10)];
    expect(computeRipplePush(clips, 50, 25)).toEqual([
      { clipId: "at", newStartFrame: 75 },
      { clipId: "after", newStartFrame: 105 },
    ]);
  });
});
