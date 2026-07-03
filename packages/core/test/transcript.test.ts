import { describe, it, expect } from "vitest";
import {
  filterTranscript, offsetTranscript, transcriptRelativePath, parseTranscriptRecord,
  type TranscriptionResult, type TranscriptRecord,
} from "../src/media/transcript.js";

const result = (over: Partial<TranscriptionResult> = {}): TranscriptionResult => ({
  text: "hello there world",
  language: "en",
  words: [
    { text: "hello", start: 0, end: 0.5 },
    { text: "there", start: 0.5, end: 1.2 },
    { text: "world", start: 1.2, end: 2 },
  ],
  segments: [
    { text: "hello there", start: 0, end: 1.2 },
    { text: "world", start: 1.2, end: 2 },
  ],
  ...over,
});

describe("filterTranscript", () => {
  it("keeps segments/words that overlap the range, drops non-overlapping ones", () => {
    const r = filterTranscript(result(), 0, 1.2);
    expect(r.segments).toEqual([{ text: "hello there", start: 0, end: 1.2 }]);
    expect(r.words.map((w) => w.text)).toEqual(["hello", "there"]);
    expect(r.text).toBe("hello there");
  });

  it("keeps elements straddling the range boundary", () => {
    // "there" spans 0.5-1.2, range starts mid-word at 0.8 — straddles the lower bound and must be kept.
    const r = filterTranscript(result(), 0.8, 2);
    expect(r.words.map((w) => w.text)).toEqual(["there", "world"]);
    expect(r.segments.map((s) => s.text)).toEqual(["hello there", "world"]);
  });

  it("uses strict overlap (touching endpoints do not count)", () => {
    // "hello" ends exactly at 0.5 (the range's start) — Swift's filter uses strict > / <, so no overlap.
    const r = filterTranscript(result(), 0.5, 1.2);
    expect(r.words.map((w) => w.text)).toEqual(["there"]);
  });

  it("keeps timestampless words only when the range covers the whole transcript", () => {
    const withGap = result({
      words: [
        { text: "hello", start: 0, end: 0.5 },
        { text: "um" }, // no timing info
        { text: "world", start: 1.2, end: 2 },
      ],
    });
    // Full-extent range (0..2): a no-op filter, so the timestampless word is kept.
    const full = filterTranscript(withGap, 0, 2);
    expect(full.words.map((w) => w.text)).toEqual(["hello", "um", "world"]);

    // Narrower range: the timestampless word is dropped, matching Swift's unconditional drop on a real window.
    const narrow = filterTranscript(withGap, 0, 1.2);
    expect(narrow.words.map((w) => w.text)).toEqual(["hello"]);
  });

  it("rebuilds text from kept segments only, joined with a space", () => {
    const r = filterTranscript(result(), 1.2, 2);
    expect(r.text).toBe("world");
  });

  it("preserves language on the filtered result", () => {
    const r = filterTranscript(result(), 0, 2);
    expect(r.language).toBe("en");
  });
});

describe("offsetTranscript", () => {
  it("shifts word and segment timestamps by offsetSec", () => {
    const r = offsetTranscript(result(), 10);
    expect(r.words.map((w) => [w.start, w.end])).toEqual([[10, 10.5], [10.5, 11.2], [11.2, 12]]);
    expect(r.segments.map((s) => [s.start, s.end])).toEqual([[10, 11.2], [11.2, 12]]);
    expect(r.text).toBe(result().text);
    expect(r.language).toBe("en");
  });

  it("leaves timestampless words untouched", () => {
    const withGap = result({ words: [{ text: "um" }] });
    const r = offsetTranscript(withGap, 5);
    expect(r.words).toEqual([{ text: "um" }]);
  });

  it("is a no-op for a zero offset (returns the same reference)", () => {
    const r = result();
    expect(offsetTranscript(r, 0)).toBe(r);
  });
});

describe("transcriptRelativePath", () => {
  it("builds media/<mediaId>.transcript.json", () => {
    expect(transcriptRelativePath("abc123")).toBe("media/abc123.transcript.json");
  });
});

describe("parseTranscriptRecord", () => {
  it("round-trips a valid record", () => {
    const record: TranscriptRecord = { ...result(), sourceDurationSeconds: 2, model: "wizper" };
    const parsed = parseTranscriptRecord(JSON.stringify(record));
    expect(parsed).toEqual(record);
  });

  it("round-trips provider: fal and provider: local", () => {
    const falRecord: TranscriptRecord = { ...result(), sourceDurationSeconds: 2, model: "fal-ai/whisper", provider: "fal" };
    expect(parseTranscriptRecord(JSON.stringify(falRecord))).toEqual(falRecord);

    const localRecord: TranscriptRecord = {
      ...result(),
      sourceDurationSeconds: 2,
      model: "onnx-community/whisper-base",
      provider: "local",
    };
    expect(parseTranscriptRecord(JSON.stringify(localRecord))).toEqual(localRecord);
  });

  it("an old untagged cache (no provider field) still parses -- cached-is-cached regardless of provider (#232)", () => {
    const untagged = { ...result(), sourceDurationSeconds: 2, model: "fal-ai/whisper" };
    const parsed = parseTranscriptRecord(JSON.stringify(untagged));
    expect(parsed).not.toBeNull();
    expect(parsed?.provider).toBeUndefined();
    expect(parsed?.text).toBe(untagged.text);
  });

  it("returns null for an invalid provider value", () => {
    const bad = { ...result(), sourceDurationSeconds: 2, model: "m", provider: "openai" };
    expect(parseTranscriptRecord(JSON.stringify(bad))).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(parseTranscriptRecord("{ not json")).toBeNull();
  });

  it("returns null for well-formed JSON with the wrong shape", () => {
    expect(parseTranscriptRecord("42")).toBeNull();
    expect(parseTranscriptRecord("[]")).toBeNull();
    expect(parseTranscriptRecord("null")).toBeNull();
    expect(parseTranscriptRecord("{}")).toBeNull();
    expect(parseTranscriptRecord(JSON.stringify({ text: "hi", words: [], segments: [] }))).toBeNull(); // missing sourceDurationSeconds/model
    expect(parseTranscriptRecord(JSON.stringify({
      text: "hi", sourceDurationSeconds: 1, model: "m", words: "not-an-array", segments: [],
    }))).toBeNull();
    expect(parseTranscriptRecord(JSON.stringify({
      text: "hi", sourceDurationSeconds: 1, model: "m", words: [{ start: 0, end: 1 }], segments: [],
    }))).toBeNull(); // word missing text
  });
});
