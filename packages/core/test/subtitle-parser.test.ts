import { describe, expect, test } from "vitest";
import {
  parseSubtitle,
  parseSubtitleFile,
  SubtitleParseError,
  subtitleFormatFromExtension,
  type SubtitleCue,
} from "../src/index.js";

describe("parseSubtitle — SRT", () => {
  test("parses SRT tolerating BOM, CRLF, mixed millis separators, missing indices, and out-of-order cues", () => {
    const srt =
      "\uFEFF1\r\n00:01:00.250 --> 00:01:02,000\r\nLine one\r\nLine two\r\n\r\n" +
      "00:00:01,000 --> 00:00:02,500\r\nFirst.\r\n\r\n" +
      "3\r\n00:00:07,000 --> 00:00:08,000\r\n<i></i>\r\n";
    const cues = parseSubtitle(srt, "srt");
    expect(cues).toEqual<SubtitleCue[]>([
      { text: "First.", startSec: 1.0, endSec: 2.5 },
      { text: "Line one\nLine two", startSec: 60.25, endSec: 62.0 },
    ]);
  });
});

describe("parseSubtitle — WebVTT", () => {
  test("parses header, comment blocks, identifiers, settings, and entity escapes", () => {
    const vtt = [
      "WEBVTT - Test file",
      "Kind: captions",
      "",
      "NOTE",
      "This comment block is skipped.",
      "",
      "STYLE",
      "::cue { color: red }",
      "",
      "intro",
      "00:05.000 --> 00:07.500 align:start line:0",
      "<v Speaker><i>Styled</i> &amp; <00:00:06.500>timed</v>{\\an8}",
      "",
      "01:00:00.000 --> 01:00:01.000",
      "Escapes: &lt;tag&gt; &amp;lt;",
      "",
    ].join("\n");
    const cues = parseSubtitle(vtt, "webvtt");
    expect(cues).toEqual<SubtitleCue[]>([
      { text: "Styled & timed", startSec: 5.0, endSec: 7.5 },
      { text: "Escapes: <tag> &lt;", startSec: 3600.0, endSec: 3601.0 },
    ]);
  });

  test("treats keyword-prefixed identifiers as cues, not comments", () => {
    const vtt = "WEBVTT\n\nNOTE123\n00:01.000 --> 00:02.000\nA cue, not a comment.\n";
    const cues = parseSubtitle(vtt, "webvtt");
    expect(cues).toEqual([{ text: "A cue, not a comment.", startSec: 1.0, endSec: 2.0 }]);
  });
});

describe("parseSubtitle — errors", () => {
  test.each([
    ["1\n00:00:xx,000 --> 00:00:01,000\nBad start.", 2],
    ["1\n00:00:01,000 --> 00:00:01,000\nEnd not after start.", 2],
    ["1\n00:75:00,000 --> 00:76:00,000\nMinutes out of range.", 2],
    ["1\n00:00:01,0000 --> 00:00:02,000\nToo many millisecond digits.", 2],
    ["No timing line at all.", 1],
  ] as const)("malformed cue throws at the timing line: %s", (srt, line) => {
    try {
      parseSubtitle(srt, "srt");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(SubtitleParseError);
      expect((err as SubtitleParseError).kind).toBe("malformedCue");
      expect((err as SubtitleParseError).line).toBe(line);
    }
  });

  test("rejects cues missing their blank-line separator", () => {
    const srt = "1\n00:00:01,000 --> 00:00:02,000\nFirst.\n2\n00:00:03,000 --> 00:00:04,000\nSwallowed.\n";
    try {
      parseSubtitle(srt, "srt");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(SubtitleParseError);
      expect((err as SubtitleParseError).kind).toBe("malformedCue");
      expect((err as SubtitleParseError).line).toBe(5);
    }
  });

  test("rejects missing WebVTT header, empty files, and unknown extensions", () => {
    expect(() => parseSubtitle("00:00.000 --> 00:01.000\nNo header.", "webvtt")).toThrow(SubtitleParseError);
    try {
      parseSubtitle("00:00.000 --> 00:01.000\nNo header.", "webvtt");
    } catch (err) {
      expect((err as SubtitleParseError).kind).toBe("missingWebVTTHeader");
    }
    try {
      parseSubtitle("WEBVTTjunk\n\n00:01.000 --> 00:02.000\nBad header.", "webvtt");
    } catch (err) {
      expect((err as SubtitleParseError).kind).toBe("missingWebVTTHeader");
    }
    try {
      parseSubtitle("", "srt");
    } catch (err) {
      expect((err as SubtitleParseError).kind).toBe("noCues");
      expect((err as SubtitleParseError).message).toBe("The file contains no captions.");
    }
    try {
      parseSubtitle("WEBVTT\n\nNOTE only comments here\n", "webvtt");
    } catch (err) {
      expect((err as SubtitleParseError).kind).toBe("noCues");
    }
    expect(subtitleFormatFromExtension("SRT")).toBe("srt");
    expect(subtitleFormatFromExtension("vtt")).toBe("webvtt");
    expect(subtitleFormatFromExtension("mov")).toBe(null);
  });

  test("parseSubtitleFile rejects an unknown extension with the Palmier message", () => {
    try {
      parseSubtitleFile(new Uint8Array(), "captions.mov");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(SubtitleParseError);
      expect((err as SubtitleParseError).kind).toBe("unsupportedFileType");
      expect((err as SubtitleParseError).message).toBe(
        "Unsupported subtitle file type “.mov”. Use SRT or WebVTT.",
      );
    }
  });
});
