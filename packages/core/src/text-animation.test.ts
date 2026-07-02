import { describe, expect, test } from "vitest";
import {
  TEXT_ANIMATION_PRESETS,
  isWordPreset,
  textLayerAnim,
  textWordState,
  wordActiveRamp,
  wordPopOvershoot,
  type TextAnimationPreset,
  type TextWordTiming,
} from "./text-animation.js";

// Swift: WordTiming fixture — three sequential, non-overlapping words (gap-free, each word's
// endFrame == the next word's startFrame) so boundary frames double as both an "end" and a "start".
const words: TextWordTiming[] = [
  { text: "Hello", startFrame: 5, endFrame: 15 },
  { text: "brave", startFrame: 15, endFrame: 25 },
  { text: "world", startFrame: 25, endFrame: 35 },
];
const wordCount = words.length;

describe("isWordPreset", () => {
  test("false only for the four whole-clip entrance presets", () => {
    const expected: Record<TextAnimationPreset, boolean> = {
      none: false, fadeIn: false, popIn: false, slideUp: false,
      typewriter: true, wordReveal: true, wordSlide: true, wordPop: true,
      wordCycle: true, highlightPop: true, highlightBlock: true,
    };
    for (const preset of TEXT_ANIMATION_PRESETS) {
      expect(isWordPreset(preset)).toBe(expected[preset]);
    }
  });
});

describe("textLayerAnim", () => {
  // Swift: TextAnimation.perWordFrames default = 6 drives clipEntry's ramp duration.
  test("fadeIn ramps opacity 0->1 over 6 frames, smoothstep-eased, then holds", () => {
    expect(textLayerAnim("fadeIn", 0, 90, 30)).toEqual({ opacity: 0, scale: 1, offsetY: 0 });
    expect(textLayerAnim("fadeIn", 3, 90, 30).opacity).toBeCloseTo(0.5); // smoothstep(0.5) = 0.5
    expect(textLayerAnim("fadeIn", 6, 90, 30).opacity).toBe(1);
    expect(textLayerAnim("fadeIn", 10, 90, 30).opacity).toBe(1); // holds past the ramp
  });

  test("popIn scales 0.6->1.0 in lockstep with the opacity ramp", () => {
    expect(textLayerAnim("popIn", 0, 90, 30)).toEqual({ opacity: 0, scale: 0.6, offsetY: 0 });
    expect(textLayerAnim("popIn", 3, 90, 30).scale).toBeCloseTo(0.8); // 0.6 + 0.4*0.5
    expect(textLayerAnim("popIn", 6, 90, 30)).toEqual({ opacity: 1, scale: 1, offsetY: 0 });
  });

  test("slideUp offsets 0.05->0 (normalized, downward-positive) as it fades in", () => {
    expect(textLayerAnim("slideUp", 0, 90, 30)).toEqual({ opacity: 0, scale: 1, offsetY: 0.05 });
    expect(textLayerAnim("slideUp", 6, 90, 30)).toEqual({ opacity: 1, scale: 1, offsetY: 0 });
  });

  test("none and word presets are the identity (no layer-level animation)", () => {
    expect(textLayerAnim("none", 3, 90, 30)).toEqual({ opacity: 1, scale: 1, offsetY: 0 });
    expect(textLayerAnim("wordReveal", 3, 90, 30)).toEqual({ opacity: 1, scale: 1, offsetY: 0 });
    expect(textLayerAnim("highlightPop", 100, 90, 30)).toEqual({ opacity: 1, scale: 1, offsetY: 0 });
  });
});

describe("textWordState", () => {
  test("non-word presets return every word visible, nothing highlighted, regardless of frame or timings", () => {
    expect(textWordState("none", words, 0, wordCount)).toEqual({ visibleCount: 3, highlightIndex: null, soloIndex: null });
    expect(textWordState("fadeIn", undefined, 999, wordCount)).toEqual({ visibleCount: 3, highlightIndex: null, soloIndex: null });
  });

  test("a word preset with no wordTimings falls back to all-visible (can't reduce without timings)", () => {
    expect(textWordState("wordReveal", undefined, 10, wordCount)).toEqual({ visibleCount: 3, highlightIndex: null, soloIndex: null });
    expect(textWordState("wordCycle", [], 10, wordCount)).toEqual({ visibleCount: 3, highlightIndex: null, soloIndex: null });
  });

  describe("typewriter", () => {
    // Swift: renderTypewriter counts a word complete once `rel >= word.endFrame`.
    test.each([
      [0, 0], [5, 0], [14, 0],
      [15, 1], [20, 1],
      [25, 2], [30, 2],
      [35, 3], [50, 3],
    ])("visibleCount at frame %i is %i", (frame, expected) => {
      expect(textWordState("typewriter", words, frame, wordCount).visibleCount).toBe(expected);
    });
  });

  describe.each(["wordReveal", "wordSlide", "wordPop"] as const)("%s", (preset) => {
    // Swift: wordState's opacity ramp is `progress(rel, start: word.startFrame, ...)`, which is
    // strictly > 0 only once rel > startFrame, then saturates at 1 forever (reveal-and-stay).
    test.each([
      [0, 0], [5, 0], [6, 1], [14, 1],
      [15, 1], [16, 2], [24, 2],
      [25, 2], [26, 3], [50, 3],
    ])("visibleCount at frame %i is %i", (frame, expected) => {
      expect(textWordState(preset, words, frame, wordCount)).toEqual({ visibleCount: expected, highlightIndex: null, soloIndex: null });
    });
  });

  describe("wordCycle", () => {
    // Swift: activeRamp windows to [word.startFrame, word.endFrame) — only one word "on" at a time.
    test.each([
      [0, null], [4, null],
      [5, 0], [14, 0],
      [15, 1], [24, 1],
      [25, 2], [34, 2],
      [35, null], [50, null],
    ])("soloIndex at frame %i is %j", (frame, expected) => {
      const state = textWordState("wordCycle", words, frame, wordCount);
      expect(state.soloIndex).toBe(expected);
      expect(state.visibleCount).toBe(wordCount); // every word still drawn — only the raster's solo choice differs
      expect(state.highlightIndex).toBeNull();
    });
  });

  describe.each(["highlightPop", "highlightBlock"] as const)("%s", (preset) => {
    test.each([
      [0, null], [4, null],
      [5, 0], [14, 0],
      [15, 1], [24, 1],
      [25, 2], [34, 2],
      [35, null], [50, null],
    ])("highlightIndex at frame %i is %j", (frame, expected) => {
      const state = textWordState(preset, words, frame, wordCount);
      expect(state.highlightIndex).toBe(expected);
      expect(state.visibleCount).toBe(wordCount); // Swift never hides words for highlight presets
      expect(state.soloIndex).toBeNull();
    });
  });
});

describe("ported continuous primitives (for T2)", () => {
  test("wordPopOvershoot matches Swift's back-ease at known points", () => {
    expect(wordPopOvershoot(0)).toBeCloseTo(0); // 1 + 2.70158*(-1) + 1.70158*1 = 0
    expect(wordPopOvershoot(1)).toBe(1);
  });

  test("wordActiveRamp is 0 outside the word's window and peaks at 1 mid-span", () => {
    const word: TextWordTiming = { text: "x", startFrame: 10, endFrame: 20 };
    expect(wordActiveRamp(9, word, 4)).toBe(0);
    expect(wordActiveRamp(20, word, 4)).toBe(0); // endFrame is exclusive
    expect(wordActiveRamp(15, word, 4)).toBe(1); // mid-span, past both ramps
    expect(wordActiveRamp(10, word, 4)).toBe(0); // rampIn = smoothstep(0) at the exact start
  });
});
