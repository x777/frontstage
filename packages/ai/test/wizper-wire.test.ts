import { describe, expect, test } from "vitest";
import { parseWizperResult, deriveWords } from "../src/generation/wizper-wire.js";
import type { TranscriptionSegment } from "@palmier/core";

describe("parseWizperResult", () => {
  test("a realistic chunks fixture maps to segments + derived words + language", () => {
    const fixture = {
      text: "Hello world. How are you today? I am fine.",
      chunks: [
        { text: "Hello world.", timestamp: [0, 1.2] },
        { text: "How are you today?", timestamp: [1.2, 3.6] },
        { text: "I am fine.", timestamp: [3.6, 4.8] },
      ],
      languages: ["en"],
    };

    const result = parseWizperResult(fixture);

    expect(result.text).toBe("Hello world. How are you today? I am fine.");
    expect(result.language).toBe("en");
    expect(result.segments).toEqual([
      { text: "Hello world.", start: 0, end: 1.2 },
      { text: "How are you today?", start: 1.2, end: 3.6 },
      { text: "I am fine.", start: 3.6, end: 4.8 },
    ]);
    expect(result.words).toHaveLength(2 + 4 + 3);
    expect(result.words[0]).toEqual({ text: "Hello", start: 0, end: 0.6 });
    expect(result.words[1]).toEqual({ text: "world.", start: 0.6, end: 1.2 });
  });

  test("chunks with a null timestamp side are dropped from segments (and their words)", () => {
    const fixture = {
      text: "kept",
      chunks: [
        { text: "no start", timestamp: [null, 2] },
        { text: "no end", timestamp: [2, null] },
        { text: "kept", timestamp: [2, 3] },
      ],
      languages: ["en"],
    };

    const result = parseWizperResult(fixture);

    expect(result.segments).toEqual([{ text: "kept", start: 2, end: 3 }]);
    expect(result.words).toEqual([{ text: "kept", start: 2, end: 3 }]);
  });

  test("a whitespace-only chunk text is dropped", () => {
    const fixture = { text: "", chunks: [{ text: "   ", timestamp: [0, 1] }], languages: [] };
    expect(parseWizperResult(fixture).segments).toEqual([]);
  });

  test("no languages -> language is undefined", () => {
    const fixture = { text: "hi", chunks: [], languages: [] };
    expect(parseWizperResult(fixture).language).toBeUndefined();
  });

  test("missing chunks/languages arrays tolerated -> empty segments/words, defined language undefined", () => {
    expect(parseWizperResult({ text: "hi" })).toEqual({ text: "hi", language: undefined, words: [], segments: [] });
  });

  test("non-object json -> empty result, never throws", () => {
    expect(parseWizperResult(null)).toEqual({ text: "", language: undefined, words: [], segments: [] });
    expect(parseWizperResult("garbage")).toEqual({ text: "", language: undefined, words: [], segments: [] });
    expect(parseWizperResult(undefined)).toEqual({ text: "", language: undefined, words: [], segments: [] });
  });

  test("a malformed chunk (non-object, missing text, bad timestamp shape) is skipped, not thrown", () => {
    const fixture = {
      text: "kept",
      chunks: [null, { timestamp: [0, 1] }, { text: "kept", timestamp: [0, 1, 2] }, { text: "kept", timestamp: [0, 1] }],
      languages: [],
    };
    expect(parseWizperResult(fixture).segments).toEqual([{ text: "kept", start: 0, end: 1 }]);
  });
});

describe("deriveWords", () => {
  test("splits a single-word segment into one word spanning the full duration", () => {
    const segments: TranscriptionSegment[] = [{ text: "Hello", start: 1, end: 3 }];
    expect(deriveWords(segments)).toEqual([{ text: "Hello", start: 1, end: 3 }]);
  });

  test("evenly splits a multi-word segment's time across its words in order", () => {
    const segments: TranscriptionSegment[] = [{ text: "a b c d", start: 0, end: 4 }];
    expect(deriveWords(segments)).toEqual([
      { text: "a", start: 0, end: 1 },
      { text: "b", start: 1, end: 2 },
      { text: "c", start: 2, end: 3 },
      { text: "d", start: 3, end: 4 },
    ]);
  });

  test("punctuation stays attached to its word (no sentence-splitting — that's not this function's job)", () => {
    const segments: TranscriptionSegment[] = [{ text: "Hello, world! How are you?", start: 0, end: 5 }];
    const words = deriveWords(segments);
    expect(words.map((w) => w.text)).toEqual(["Hello,", "world!", "How", "are", "you?"]);
  });

  test("multiple segments: word timing resets at each segment's own start, no bleed-over", () => {
    const segments: TranscriptionSegment[] = [
      { text: "a b", start: 0, end: 2 },
      { text: "c d", start: 10, end: 12 },
    ];
    const words = deriveWords(segments);
    expect(words).toEqual([
      { text: "a", start: 0, end: 1 },
      { text: "b", start: 1, end: 2 },
      { text: "c", start: 10, end: 11 },
      { text: "d", start: 11, end: 12 },
    ]);
  });

  test("a zero-duration segment doesn't divide by zero — words collapse to the segment's start", () => {
    const segments: TranscriptionSegment[] = [{ text: "a b", start: 5, end: 5 }];
    expect(deriveWords(segments)).toEqual([
      { text: "a", start: 5, end: 5 },
      { text: "b", start: 5, end: 5 },
    ]);
  });

  test("collapses internal multi-space runs and ignores an all-whitespace segment", () => {
    const segments: TranscriptionSegment[] = [
      { text: "a   b", start: 0, end: 2 },
      { text: "   ", start: 2, end: 3 },
    ];
    expect(deriveWords(segments)).toEqual([
      { text: "a", start: 0, end: 1 },
      { text: "b", start: 1, end: 2 },
    ]);
  });

  test("empty segments list -> empty words", () => {
    expect(deriveWords([])).toEqual([]);
  });
});
