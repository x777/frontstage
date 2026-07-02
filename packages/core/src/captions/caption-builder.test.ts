import { describe, it, expect } from "vitest";
import { buildCaptionPhrases } from "./caption-builder.js";
import type { TranscriptionSegment, TranscriptionWord } from "../media/transcript.js";

// Fake measure: returns the raw character count, so tests can set maxWidthFrac to an exact
// character threshold instead of reasoning about a fraction-of-canvas unit.
const chars = (t: string): number => t.length;

describe("buildCaptionPhrases — split priorities", () => {
  it("a fitting sentence stays whole", () => {
    const text = "Hello world today.";
    const result = buildCaptionPhrases([{ text, start: 0, end: 2 }], [], {
      measure: chars,
      maxWidthFrac: text.length,
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toBe(text);
  });

  it("splits at a sentence boundary (.!?) before ever trying a clause boundary", () => {
    const first = "Alpha bravo charlie delta, echo foxtrot golf.";
    const second = "Hotel india juliet kilo, lima mike november.";
    const text = `${first} ${second}`;
    const result = buildCaptionPhrases([{ text, start: 0, end: 10 }], [], {
      measure: chars,
      maxWidthFrac: Math.max(first.length, second.length),
    });
    expect(result.map((p) => p.text)).toEqual([first, second]);
  });

  it("falls back to a clause boundary (,;:) when there is no sentence boundary", () => {
    const first = "Alpha bravo charlie delta echo foxtrot golf hotel";
    const second = "india juliet kilo lima mike november oscar papa";
    const text = `${first}, ${second}`;
    const result = buildCaptionPhrases([{ text, start: 0, end: 10 }], [], {
      measure: chars,
      maxWidthFrac: Math.max(first.length + 1, second.length),
    });
    // the comma stays attached to the piece that precedes it
    expect(result.map((p) => p.text)).toEqual([`${first},`, second]);
  });

  it("falls back to a raw midword split as a last resort", () => {
    const words = ["w1", "w2", "w3", "w4", "w5", "w6", "w7", "w8"];
    const text = words.join(" ");
    const halfA = words.slice(0, 4).join(" ");
    const halfB = words.slice(4).join(" ");
    const result = buildCaptionPhrases([{ text, start: 0, end: 8 }], [], {
      measure: chars,
      maxWidthFrac: Math.max(halfA.length, halfB.length),
    });
    expect(result.map((p) => p.text)).toEqual([halfA, halfB]);
  });

  it("honors maxWords even when the text already fits the width", () => {
    const text = "w1 w2 w3 w4 w5 w6 w7 w8";
    const result = buildCaptionPhrases([{ text, start: 0, end: 8 }], [], {
      measure: chars,
      maxWidthFrac: text.length * 10, // width is never the constraint here
      maxWords: 3,
    });
    expect(result.map((p) => p.text)).toEqual(["w1 w2", "w3 w4", "w5 w6", "w7 w8"]);
    for (const phrase of result) {
      expect(phrase.text.split(" ")).toHaveLength(2);
    }
  });

  it("keeps a single over-long word intact rather than looping forever", () => {
    const text = "supercalifragilisticexpialidocious";
    const result = buildCaptionPhrases([{ text, start: 0, end: 1 }], [], {
      measure: chars,
      maxWidthFrac: 5,
    });
    expect(result.map((p) => p.text)).toEqual([text]);
  });
});

describe("buildCaptionPhrases — word timing alignment", () => {
  it("times a whole phrase from its member words by alphanumeric character count", () => {
    const words: TranscriptionWord[] = [
      { text: "hi", start: 0, end: 1 },
      { text: "there", start: 1, end: 2 },
    ];
    const result = buildCaptionPhrases([{ text: "hi there", start: 0, end: 2 }], words, {
      measure: chars,
      maxWidthFrac: 100,
    });
    expect(result).toEqual([
      {
        text: "hi there",
        startSec: 0,
        endSec: 2,
        words: [
          { text: "hi", startSec: 0, endSec: 1 },
          { text: "there", startSec: 1, endSec: 2 },
        ],
      },
    ]);
  });

  it("falls back to distributing time by character count when there is no word timing", () => {
    const text = "aaaa bbbbbbbb"; // 4-char word + 8-char word
    const result = buildCaptionPhrases([{ text, start: 0, end: 12 }], [], {
      measure: chars,
      maxWidthFrac: 100,
      maxWords: 1,
    });
    expect(result.map((p) => p.text)).toEqual(["aaaa", "bbbbbbbb"]);
    expect(result[0]!.startSec).toBeCloseTo(0);
    expect(result[0]!.endSec).toBeCloseTo(4);
    expect(result[1]!.startSec).toBeCloseTo(4);
    expect(result[1]!.endSec).toBeCloseTo(12);
  });

  it("assigns a word whose midpoint sits exactly on a segment boundary to the later segment", () => {
    const segments: TranscriptionSegment[] = [
      { text: "seg1", start: 0, end: 2 },
      { text: "seg2", start: 2, end: 4 },
    ];
    const words: TranscriptionWord[] = [
      { text: "w1", start: 0, end: 1 }, // mid 0.5 -> seg1
      { text: "w2", start: 1.5, end: 2.5 }, // mid 2.0 -> exactly seg1.end / seg2.start -> seg2
      { text: "w3", start: 3, end: 4 }, // mid 3.5 -> seg2
    ];
    const result = buildCaptionPhrases(segments, words, { measure: chars, maxWidthFrac: 1000 });
    expect(result).toHaveLength(2);
    expect(result[0]!.text).toBe("w1");
    expect(result[1]!.text).toBe("w2 w3");
  });

  it("builds a fallback segment spanning the words' extent when segments is empty", () => {
    const words: TranscriptionWord[] = [
      { text: "one", start: 5, end: 6 },
      { text: "two", start: 6, end: 7 },
    ];
    const result = buildCaptionPhrases([], words, { measure: chars, maxWidthFrac: 1000 });
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toBe("one two");
    expect(result[0]!.startSec).toBe(5);
    expect(result[0]!.endSec).toBe(7);
  });

  it("drops words without timing when computing hasWordTimings, using the no-timing path", () => {
    const words: TranscriptionWord[] = [{ text: "untimed" }];
    const text = "plain segment text";
    const result = buildCaptionPhrases([{ text, start: 0, end: 3 }], words, {
      measure: chars,
      maxWidthFrac: 1000,
    });
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toBe(text);
    expect(result[0]!.words).toEqual([]);
  });

  it("skips degenerate (zero-duration) segments in the no-word-timing path", () => {
    const result = buildCaptionPhrases(
      [
        { text: "empty", start: 5, end: 5 },
        { text: "ok", start: 5, end: 6 },
      ],
      [],
      { measure: chars, maxWidthFrac: 1000 },
    );
    expect(result.map((p) => p.text)).toEqual(["ok"]);
  });
});
