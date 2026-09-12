import type { SubtitleCue } from "./subtitle-export.js";

export type SubtitleFormat = "srt" | "webvtt";

export type SubtitleParseErrorKind =
  | "unsupportedFileType"
  | "missingWebVTTHeader"
  | "malformedCue"
  | "noCues";

export class SubtitleParseError extends Error {
  readonly kind: SubtitleParseErrorKind;
  readonly line?: number;
  readonly ext?: string;

  constructor(kind: SubtitleParseErrorKind, message: string, extra?: { line?: number; ext?: string }) {
    super(message);
    this.name = "SubtitleParseError";
    this.kind = kind;
    this.line = extra?.line;
    this.ext = extra?.ext;
  }
}

export function subtitleFormatFromExtension(ext: string): SubtitleFormat | null {
  switch (ext.toLowerCase()) {
    case "srt":
      return "srt";
    case "vtt":
      return "webvtt";
    default:
      return null;
  }
}

export function decodeSubtitleBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("latin1").decode(bytes);
  }
}

function extOfFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot + 1);
}

/** Infers SRT/WebVTT from the filename extension (Swift: `url.pathExtension`). */
export function parseSubtitleFile(bytes: Uint8Array, filename: string): SubtitleCue[] {
  const ext = extOfFilename(filename);
  const format = subtitleFormatFromExtension(ext);
  if (!format) {
    throw new SubtitleParseError(
      "unsupportedFileType",
      `Unsupported subtitle file type “.${ext}”. Use SRT or WebVTT.`,
      { ext },
    );
  }
  return parseSubtitleBytes(bytes, format);
}

export function parseSubtitleBytes(bytes: Uint8Array, format: SubtitleFormat): SubtitleCue[] {
  return parseSubtitle(decodeSubtitleBytes(bytes), format);
}

/**
 * Parses SRT or WebVTT contents into plain-text cues.
 * 1:1 with Palmier v0.9.0 `SubtitleFileParser.parse(_:format:)`.
 */
export function parseSubtitle(contents: string, format: SubtitleFormat): SubtitleCue[] {
  let normalized = contents;
  if (normalized.startsWith("\uFEFF")) normalized = normalized.slice(1);
  const lines = normalized.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").map((line) => line.trim());

  // Blank-line-separated blocks, tagged with their 0-based starting line.
  const blocks: { start: number; lines: string[] }[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (line.length === 0) continue;
    const last = blocks[blocks.length - 1];
    if (last && last.start + last.lines.length === index) {
      last.lines.push(line);
    } else {
      blocks.push({ start: index, lines: [line] });
    }
  }

  if (format === "webvtt") {
    const header = blocks[0]?.lines[0];
    if (!header || !isKeywordLine(header, "WEBVTT")) {
      throw new SubtitleParseError("missingWebVTTHeader", "Not a WebVTT file — the WEBVTT header is missing.");
    }
    blocks.shift();
  }

  const cues: SubtitleCue[] = [];
  for (const block of blocks) {
    if (format === "webvtt" && ["NOTE", "STYLE", "REGION"].some((kw) => isKeywordLine(block.lines[0]!, kw))) {
      continue;
    }
    // The timing line may be preceded by one SRT index or WebVTT cue-identifier line.
    const timingIndex = block.lines.slice(0, 2).findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) {
      throw new SubtitleParseError("malformedCue", `Malformed cue timing at line ${block.start + 1}.`, {
        line: block.start + 1,
      });
    }
    const sides = block.lines[timingIndex]!.split("-->");
    const start = sides.length === 2 ? secondsIn(sides[0]!) : undefined;
    const end = sides.length === 2 ? secondsIn(sides[1]!) : undefined;
    if (start === undefined || end === undefined || !(end > start)) {
      const line = block.start + timingIndex + 1;
      throw new SubtitleParseError("malformedCue", `Malformed cue timing at line ${line}.`, { line });
    }
    const textLines: string[] = [];
    for (let offset = timingIndex + 1; offset < block.lines.length; offset++) {
      const line = block.lines[offset]!;
      if (line.includes("-->")) {
        const at = block.start + offset + 1;
        throw new SubtitleParseError("malformedCue", `Malformed cue timing at line ${at}.`, { line: at });
      }
      const stripped = plainText(line);
      if (stripped.length > 0) textLines.push(stripped);
    }
    const text = textLines.join("\n");
    if (text.length > 0) {
      cues.push({ text, startSec: start, endSec: end });
    }
  }
  if (cues.length === 0) {
    throw new SubtitleParseError("noCues", "The file contains no captions.");
  }
  return cues.sort((a, b) => a.startSec - b.startSec);
}

function isKeywordLine(line: string, keyword: string): boolean {
  return line === keyword || line.startsWith(keyword + " ") || line.startsWith(keyword + "\t");
}

/**
 * `HH:MM:SS.mmm` and `MM:SS.mmm` with `.` or `,` milliseconds. Trailing WebVTT cue
 * settings and SRT coordinate extensions are ignored. The digit bounds keep the
 * largest expressible time (< 10,000 h) safely inside frame-count `Int` math.
 */
function secondsIn(token: string): number | undefined {
  const pattern = /^(?:(\d{1,4}):)?([0-5]?\d):([0-5]?\d)[.,](\d{1,3})(?=\s|$)/;
  const match = token.trim().match(pattern);
  if (!match) return undefined;
  const hours = match[1] !== undefined ? Number(match[1]) : 0;
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const fraction = match[4]!;
  const milliseconds = Number(fraction) * [100, 10, 1][fraction.length - 1]!;
  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
}

export function plainText(line: string): string {
  let text = line.replace(/<[^>]*>|\{[^}]*\}/g, "");
  // `&amp;` decodes last so `&amp;lt;` yields the literal `&lt;`.
  const entities: [string, string][] = [
    ["&lt;", "<"],
    ["&gt;", ">"],
    ["&nbsp;", "\u00A0"],
    ["&lrm;", "\u200E"],
    ["&rlm;", "\u200F"],
    ["&amp;", "&"],
  ];
  for (const [entity, value] of entities) {
    text = text.split(entity).join(value);
  }
  return text.trim();
}

/** Last cue's end, in seconds — Palmier's subtitle-asset duration. */
export function subtitleDurationSeconds(cues: SubtitleCue[]): number {
  let end = 0;
  for (const cue of cues) {
    if (cue.endSec > end) end = cue.endSec;
  }
  return end;
}
