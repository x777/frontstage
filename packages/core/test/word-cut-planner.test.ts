import { describe, expect, test } from "vitest";
import { cutRanges, keptGapFrames } from "../src/media/word-cut-planner.js";
import type { TimelineWord } from "../src/media/timeline-words.js";

function w(index: number, startFrame: number, endFrame: number): TimelineWord {
  return { index, text: `w${index}`, startFrame, endFrame, clipId: "c1", trackIndex: 0 };
}

describe("keptGapFrames", () => {
  test("60/150/320ms at 30fps round to Swift's msToFrames output", () => {
    expect(keptGapFrames("tight", 30)).toBe(2); // 60/1000*30 = 1.8 -> 2
    expect(keptGapFrames("balanced", 30)).toBe(5); // 150/1000*30 = 4.5 -> 5 (round half up)
    expect(keptGapFrames("loose", 30)).toBe(10); // 320/1000*30 = 9.6 -> 10
  });

  test("scales with fps", () => {
    expect(keptGapFrames("tight", 24)).toBe(1); // 60/1000*24 = 1.44 -> 1
  });
});

describe("cutRanges", () => {
  test("a single selected word pads inward by half the kept gap on both sides", () => {
    const words = [w(0, 20, 25)];
    const ranges = cutRanges(words, new Set([0]), 0, 50, 4); // half = 2
    expect(ranges).toEqual([{ start: 2, end: 48 }]);
  });

  test("a contiguous selected run merges into one range", () => {
    const words = [w(0, 10, 15), w(1, 15, 20), w(2, 20, 26)];
    const ranges = cutRanges(words, new Set([0, 1, 2]), 0, 40, 4); // half = 2
    expect(ranges).toEqual([{ start: 2, end: 38 }]);
  });

  test("two runs separated by a kept word produce two ranges padded off the real neighbour", () => {
    const words = [w(0, 10, 15), w(1, 20, 22), w(2, 30, 35)];
    const ranges = cutRanges(words, new Set([0, 2]), 0, 50, 10); // half = 5
    // run0: left=clipStart(0), right=kept.start(20) -> keepBefore=5, keepAfter=5 -> [5,15)
    // run2: left=kept.end(22), right=clipEnd(50) -> keepBefore=min(8,5)=5, keepAfter=5 -> [27,45)
    expect(ranges).toEqual([
      { start: 5, end: 15 },
      { start: 27, end: 45 },
    ]);
    // the kept word's own frames [20,22) are never touched
    expect(ranges.every((r) => r.end <= 20 || r.start >= 22)).toBe(true);
  });

  test("overlapping per-run pads merge into one range", () => {
    // Deliberately out-of-order word timing (word1 nested inside word0's span) so the two
    // independently-padded runs land overlapping — exercises the trailing mergeRanges call.
    const words = [w(0, 10, 30), w(1, 20, 25), w(2, 26, 50)];
    const ranges = cutRanges(words, new Set([0, 2]), 0, 60, 10); // half = 5
    expect(ranges).toEqual([{ start: 5, end: 55 }]);
  });

  test("clamps the output range to [clipStart, clipEnd)", () => {
    const words = [w(0, 0, 50)]; // word overruns both declared clip edges
    const ranges = cutRanges(words, new Set([0]), 10, 40, 100); // half = 50
    expect(ranges).toEqual([{ start: 10, end: 40 }]);
  });

  test("unselected words never appear in the output", () => {
    const words = [w(0, 10, 15), w(1, 20, 25)];
    const ranges = cutRanges(words, new Set([0]), 0, 40, 4);
    expect(ranges).toEqual([{ start: 2, end: 18 }]);
  });

  test("zero-length words are filtered out and don't extend a run's bounds", () => {
    // If word0 weren't dropped it would merge with word1 into one run starting at frame 10;
    // dropped, the surviving run's own bounds (word1: 15-20) are what padding measures from.
    const words = [w(0, 10, 10), w(1, 15, 20)];
    const ranges = cutRanges(words, new Set([0, 1]), 0, 100, 40); // half = 20
    expect(ranges).toEqual([{ start: 15, end: 80 }]);
  });

  test("empty selection yields no ranges", () => {
    expect(cutRanges([w(0, 10, 15)], new Set(), 0, 40, 4)).toEqual([]);
  });
});
