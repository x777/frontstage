import { describe, expect, test } from "vitest";
import {
  cuesFromCaptionClips,
  cuesFromTranscript,
  defaultCrop,
  defaultTimeline,
  defaultTransform,
  formatSrt,
  formatVtt,
  type Clip,
  type SubtitleCue,
  type Timeline,
  type Track,
  type TranscriptionResult,
} from "../src/index.js";

function makeClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: "c1",
    mediaRef: "m1",
    mediaType: "text",
    sourceClipType: "text",
    startFrame: 0,
    durationFrames: 30,
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
    ...overrides,
  };
}

function makeTrack(id: string, clips: Clip[]): Track {
  return { id, type: "video", muted: false, hidden: false, syncLocked: false, clips };
}

describe("formatSrt", () => {
  test("single cue: 1-based index, comma ms separator, CRLF endings", () => {
    const cues: SubtitleCue[] = [{ startSec: 1, endSec: 4, text: "Hello world" }];
    expect(formatSrt(cues)).toBe("1\r\n00:00:01,000 --> 00:00:04,000\r\nHello world\r\n");
  });

  test("two cues: blank line between blocks, incrementing 1-based index", () => {
    const cues: SubtitleCue[] = [
      { startSec: 0, endSec: 1, text: "One" },
      { startSec: 1, endSec: 2, text: "Two" },
    ];
    expect(formatSrt(cues)).toBe(
      "1\r\n00:00:00,000 --> 00:00:01,000\r\nOne\r\n" +
        "\r\n" +
        "2\r\n00:00:01,000 --> 00:00:02,000\r\nTwo\r\n",
    );
  });

  test("ms zero-padded to 3 digits", () => {
    const cues: SubtitleCue[] = [{ startSec: 0.005, endSec: 0.09, text: "x" }];
    expect(formatSrt(cues)).toBe("1\r\n00:00:00,005 --> 00:00:00,090\r\nx\r\n");
  });

  test("hour rollover (3661.5s = 01:01:01,500)", () => {
    const cues: SubtitleCue[] = [{ startSec: 3661.5, endSec: 3661.5, text: "x" }];
    expect(formatSrt(cues)).toBe("1\r\n01:01:01,500 --> 01:01:01,500\r\nx\r\n");
  });

  test("ms rounding at a 29.97fps frame boundary", () => {
    // frame 90 at 30000/1001 fps -> 90 * 1001/30000 = 3.003 s exactly -> 00:00:03,003
    const startSec = 90 * (1001 / 30000);
    const cues: SubtitleCue[] = [{ startSec, endSec: startSec, text: "x" }];
    expect(formatSrt(cues)).toBe("1\r\n00:00:03,003 --> 00:00:03,003\r\nx\r\n");
  });

  test("empty cue list yields an empty string", () => {
    expect(formatSrt([])).toBe("");
  });
});

describe("formatVtt", () => {
  test("WEBVTT header, dot ms separator, LF endings", () => {
    const cues: SubtitleCue[] = [{ startSec: 1, endSec: 4, text: "Hello world" }];
    expect(formatVtt(cues)).toBe("WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nHello world\n");
  });

  test("two cues: blank line between blocks", () => {
    const cues: SubtitleCue[] = [
      { startSec: 0, endSec: 1, text: "One" },
      { startSec: 1, endSec: 2, text: "Two" },
    ];
    expect(formatVtt(cues)).toBe(
      "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nOne\n" + "\n" + "00:00:01.000 --> 00:00:02.000\nTwo\n",
    );
  });

  test("hour rollover (3661.5s = 01:01:01.500)", () => {
    const cues: SubtitleCue[] = [{ startSec: 3661.5, endSec: 3661.5, text: "x" }];
    expect(formatVtt(cues)).toBe("WEBVTT\n\n01:01:01.500 --> 01:01:01.500\nx\n");
  });

  test("no cues yields just the header", () => {
    expect(formatVtt([])).toBe("WEBVTT\n\n");
  });
});

describe("cuesFromTranscript", () => {
  function makeResult(segments: TranscriptionResult["segments"]): TranscriptionResult {
    return { text: "", words: [], segments };
  }

  test("maps segments to cues in order", () => {
    const result = makeResult([
      { text: "Hello", start: 0, end: 1 },
      { text: "World", start: 1, end: 2 },
    ]);
    expect(cuesFromTranscript(result)).toEqual([
      { startSec: 0, endSec: 1, text: "Hello" },
      { startSec: 1, endSec: 2, text: "World" },
    ]);
  });

  test("skips segments with empty or whitespace-only text", () => {
    const result = makeResult([
      { text: "Hello", start: 0, end: 1 },
      { text: "", start: 1, end: 2 },
      { text: "   ", start: 2, end: 3 },
      { text: "World", start: 3, end: 4 },
    ]);
    expect(cuesFromTranscript(result)).toEqual([
      { startSec: 0, endSec: 1, text: "Hello" },
      { startSec: 3, endSec: 4, text: "World" },
    ]);
  });

  test("empty segments list yields no cues", () => {
    expect(cuesFromTranscript(makeResult([]))).toEqual([]);
  });
});

describe("cuesFromCaptionClips", () => {
  test("only clips with captionGroupId are included", () => {
    const timeline: Timeline = {
      ...defaultTimeline(),
      fps: 30,
      tracks: [
        makeTrack("t1", [
          makeClip({ id: "c1", captionGroupId: "g1", textContent: "Caption A", startFrame: 0, durationFrames: 30 }),
          makeClip({ id: "c2", mediaType: "video", sourceClipType: "video", startFrame: 30, durationFrames: 30 }),
        ]),
      ],
    };
    expect(cuesFromCaptionClips(timeline, 30)).toEqual([{ startSec: 0, endSec: 1, text: "Caption A" }]);
  });

  test("chronological by startFrame across tracks, not insertion order", () => {
    const timeline: Timeline = {
      ...defaultTimeline(),
      fps: 30,
      tracks: [
        makeTrack("t1", [makeClip({ id: "c2", captionGroupId: "g1", textContent: "Second", startFrame: 30, durationFrames: 30 })]),
        makeTrack("t2", [makeClip({ id: "c1", captionGroupId: "g1", textContent: "First", startFrame: 0, durationFrames: 30 })]),
      ],
    };
    expect(cuesFromCaptionClips(timeline, 30)).toEqual([
      { startSec: 0, endSec: 1, text: "First" },
      { startSec: 1, endSec: 2, text: "Second" },
    ]);
  });

  test("cue span is [startFrame/fps, (startFrame+durationFrames)/fps]", () => {
    const timeline: Timeline = {
      ...defaultTimeline(),
      fps: 25,
      tracks: [makeTrack("t1", [makeClip({ captionGroupId: "g1", textContent: "X", startFrame: 50, durationFrames: 75 })])],
    };
    expect(cuesFromCaptionClips(timeline, 25)).toEqual([{ startSec: 2, endSec: 5, text: "X" }]);
  });

  test("no caption clips yields an empty array", () => {
    const timeline: Timeline = {
      ...defaultTimeline(),
      tracks: [makeTrack("t1", [makeClip({ mediaType: "video", sourceClipType: "video" })])],
    };
    expect(cuesFromCaptionClips(timeline, 30)).toEqual([]);
  });
});
