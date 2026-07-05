import { describe, expect, test } from "vitest";
import { parseWhisperResult, deriveSegments } from "../src/generation/whisper-wire.js";
import type { TranscriptionWord } from "@frontstage/core";

describe("parseWhisperResult", () => {
  test("a realistic word-chunks fixture maps chunks 1:1 to words, punctuation groups them into segments", () => {
    const fixture = {
      text: "Hello world. How are you today? I am fine.",
      chunks: [
        { text: "Hello", timestamp: [0, 0.4] },
        { text: "world.", timestamp: [0.4, 1.2] },
        { text: "How", timestamp: [1.2, 1.5] },
        { text: "are", timestamp: [1.5, 1.8] },
        { text: "you", timestamp: [1.8, 2.1] },
        { text: "today?", timestamp: [2.1, 3.6] },
        { text: "I", timestamp: [3.6, 3.7] },
        { text: "am", timestamp: [3.7, 4.0] },
        { text: "fine.", timestamp: [4.0, 4.8] },
      ],
      inferred_languages: ["en"],
    };

    const result = parseWhisperResult(fixture);

    expect(result.text).toBe("Hello world. How are you today? I am fine.");
    expect(result.language).toBe("en");
    expect(result.words).toEqual([
      { text: "Hello", start: 0, end: 0.4 },
      { text: "world.", start: 0.4, end: 1.2 },
      { text: "How", start: 1.2, end: 1.5 },
      { text: "are", start: 1.5, end: 1.8 },
      { text: "you", start: 1.8, end: 2.1 },
      { text: "today?", start: 2.1, end: 3.6 },
      { text: "I", start: 3.6, end: 3.7 },
      { text: "am", start: 3.7, end: 4.0 },
      { text: "fine.", start: 4.0, end: 4.8 },
    ]);
    expect(result.segments).toEqual([
      { text: "Hello world.", start: 0, end: 1.2 },
      { text: "How are you today?", start: 1.2, end: 3.6 },
      { text: "I am fine.", start: 3.6, end: 4.8 },
    ]);
  });

  test("a chunk with a null timestamp side is kept as a word with undefined times, not dropped", () => {
    const fixture = {
      text: "hi there",
      chunks: [
        { text: "hi", timestamp: [null, null] },
        { text: "there.", timestamp: [1, 1.5] },
      ],
      inferred_languages: ["en"],
    };

    const result = parseWhisperResult(fixture);

    expect(result.words).toEqual([
      { text: "hi", start: undefined, end: undefined },
      { text: "there.", start: 1, end: 1.5 },
    ]);
    // segment bounds come from the sole timestamped word; the timestampless one stays in the text
    expect(result.segments).toEqual([{ text: "hi there.", start: 1, end: 1.5 }]);
  });

  test("a segment with NO timestamped words at all is dropped (but its words are kept)", () => {
    const fixture = {
      text: "untimed.",
      chunks: [{ text: "untimed.", timestamp: [null, null] }],
      inferred_languages: [],
    };

    const result = parseWhisperResult(fixture);

    expect(result.words).toEqual([{ text: "untimed.", start: undefined, end: undefined }]);
    expect(result.segments).toEqual([]);
  });

  test("a multi-word chunk (chunk_level reverted to segment upstream) falls back to an even time-split", () => {
    const fixture = {
      text: "hi there",
      chunks: [{ text: "hi there", timestamp: [0, 1] }],
      inferred_languages: [],
    };

    const result = parseWhisperResult(fixture);

    expect(result.words).toEqual([
      { text: "hi", start: 0, end: 0.5 },
      { text: "there", start: 0.5, end: 1 },
    ]);
    expect(result.segments).toEqual([{ text: "hi there", start: 0, end: 1 }]);
  });

  test("a multi-word chunk with a null timestamp side falls back without fabricating times", () => {
    const fixture = {
      text: "hi there",
      chunks: [{ text: "hi there", timestamp: [null, 1] }],
      inferred_languages: [],
    };

    expect(parseWhisperResult(fixture).words).toEqual([
      { text: "hi", start: undefined, end: undefined },
      { text: "there", start: undefined, end: undefined },
    ]);
  });

  test("a whitespace-only chunk text yields no words", () => {
    const fixture = { text: "", chunks: [{ text: "   ", timestamp: [0, 1] }], inferred_languages: [] };
    expect(parseWhisperResult(fixture).words).toEqual([]);
  });

  test("no inferred_languages -> language is undefined", () => {
    const fixture = { text: "hi", chunks: [], inferred_languages: [] };
    expect(parseWhisperResult(fixture).language).toBeUndefined();
  });

  test("missing chunks/inferred_languages arrays tolerated -> empty words/segments, language undefined", () => {
    expect(parseWhisperResult({ text: "hi" })).toEqual({ text: "hi", language: undefined, words: [], segments: [] });
  });

  test("non-object json -> empty result, never throws", () => {
    expect(parseWhisperResult(null)).toEqual({ text: "", language: undefined, words: [], segments: [] });
    expect(parseWhisperResult("garbage")).toEqual({ text: "", language: undefined, words: [], segments: [] });
    expect(parseWhisperResult(undefined)).toEqual({ text: "", language: undefined, words: [], segments: [] });
  });

  test("a malformed chunk (non-object, missing text, bad timestamp shape) is skipped, not thrown", () => {
    const fixture = {
      text: "kept",
      chunks: [null, { timestamp: [0, 1] }, { text: "kept", timestamp: [0, 1, 2] }, { text: "kept", timestamp: [0, 1] }],
      inferred_languages: [],
    };
    expect(parseWhisperResult(fixture).words).toEqual([{ text: "kept", start: 0, end: 1 }]);
  });
});

describe("deriveSegments", () => {
  test("splits after a word ending in '.', '!', or '?'", () => {
    const words: TranscriptionWord[] = [
      { text: "Hi.", start: 0, end: 0.5 },
      { text: "Wow!", start: 0.5, end: 1 },
      { text: "Really?", start: 1, end: 1.5 },
    ];
    expect(deriveSegments(words)).toEqual([
      { text: "Hi.", start: 0, end: 0.5 },
      { text: "Wow!", start: 0.5, end: 1 },
      { text: "Really?", start: 1, end: 1.5 },
    ]);
  });

  test("words with no terminal punctuation stay in one segment until the stream ends", () => {
    const words: TranscriptionWord[] = [
      { text: "a", start: 0, end: 1 },
      { text: "b", start: 1, end: 2 },
      { text: "c", start: 2, end: 3 },
    ];
    expect(deriveSegments(words)).toEqual([{ text: "a b c", start: 0, end: 3 }]);
  });

  test("a 30-word cap forces a split even without terminal punctuation", () => {
    const words: TranscriptionWord[] = Array.from({ length: 35 }, (_, i) => ({
      text: `w${i}`,
      start: i,
      end: i + 1,
    }));
    const segments = deriveSegments(words);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toEqual({ text: Array.from({ length: 30 }, (_, i) => `w${i}`).join(" "), start: 0, end: 30 });
    expect(segments[1]).toEqual({ text: Array.from({ length: 5 }, (_, i) => `w${30 + i}`).join(" "), start: 30, end: 35 });
  });

  test("leading/trailing timestampless words are skipped for bounds but kept in the segment text", () => {
    const words: TranscriptionWord[] = [
      { text: "um", start: undefined, end: undefined },
      { text: "hello", start: 1, end: 1.5 },
      { text: "world", start: 1.5, end: 2 },
      { text: "uh.", start: undefined, end: undefined },
    ];
    // "uh." (the sentence-ending word) is what triggers the flush — bounds still come from the
    // timestamped words only, with the leading/trailing timestampless ones kept in the text.
    expect(deriveSegments(words)).toEqual([{ text: "um hello world uh.", start: 1, end: 2 }]);
  });

  test("a segment with no timestamped words at all is dropped", () => {
    const words: TranscriptionWord[] = [
      { text: "um.", start: undefined, end: undefined },
      { text: "next", start: 1, end: 2 },
    ];
    expect(deriveSegments(words)).toEqual([{ text: "next", start: 1, end: 2 }]);
  });

  test("empty words list -> empty segments", () => {
    expect(deriveSegments([])).toEqual([]);
  });
});
