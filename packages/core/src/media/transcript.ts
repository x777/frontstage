export interface TranscriptionWord {
  text: string;
  start?: number; // source-media seconds
  end?: number;
  speaker?: string;
}

export interface TranscriptionSegment {
  text: string;
  start: number;
  end: number;
  speaker?: string;
}

export interface TranscriptionResult {
  text: string;
  language?: string;
  words: TranscriptionWord[];
  segments: TranscriptionSegment[];
}

/** The full-file cache record at media/<mediaId>.transcript.json (the #232 invariant). */
export interface TranscriptRecord extends TranscriptionResult {
  sourceDurationSeconds: number;
  model: string;
  // M14A: absent on pre-existing caches (fal was the only provider then) — cached-is-cached
  // regardless of provider, so parsing/cache-hit logic never requires this field (#232).
  provider?: "fal" | "local";
}

/**
 * Overlap-keep filter, matching Swift's TranscriptCache.filter(_:to:): segments/words whose span
 * overlaps [startSec, endSec) survive, including ones straddling a boundary. Deviation: Swift's guard
 * unconditionally drops timestampless words on any filter call; here they're kept when the requested
 * range covers the whole transcript (a no-op filter) and dropped otherwise.
 */
export function filterTranscript(r: TranscriptionResult, startSec: number, endSec: number): TranscriptionResult {
  const segments = r.segments.filter((s) => s.end > startSec && s.start < endSec);
  const extent = transcriptExtent(r);
  const coversWhole = extent === undefined || (startSec <= extent.min && endSec >= extent.max);
  const words = r.words.filter((w) => {
    if (w.start === undefined || w.end === undefined) return coversWhole;
    return w.end > startSec && w.start < endSec;
  });
  return {
    text: segments.map((s) => s.text).join(" "),
    language: r.language,
    words,
    segments,
  };
}

function transcriptExtent(r: TranscriptionResult): { min: number; max: number } | undefined {
  let min = Infinity;
  let max = -Infinity;
  for (const s of r.segments) {
    if (s.start < min) min = s.start;
    if (s.end > max) max = s.end;
  }
  for (const w of r.words) {
    if (w.start !== undefined && w.start < min) min = w.start;
    if (w.end !== undefined && w.end > max) max = w.end;
  }
  return min <= max ? { min, max } : undefined;
}

/** Shifts all timestamps by offsetSec (port of Swift's TranscriptionResult.offsetting(by:)). */
export function offsetTranscript(r: TranscriptionResult, offsetSec: number): TranscriptionResult {
  if (offsetSec === 0) return r;
  return {
    text: r.text,
    language: r.language,
    words: r.words.map((w) => ({
      ...w,
      start: w.start === undefined ? undefined : w.start + offsetSec,
      end: w.end === undefined ? undefined : w.end + offsetSec,
    })),
    segments: r.segments.map((s) => ({ ...s, start: s.start + offsetSec, end: s.end + offsetSec })),
  };
}

export function transcriptRelativePath(mediaId: string): string {
  return `media/${mediaId}.transcript.json`;
}

/** Tolerant parse of a cached TranscriptRecord: any shape mismatch returns null rather than throwing. */
export function parseTranscriptRecord(json: string): TranscriptRecord | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.text !== "string") return null;
  if (typeof obj.sourceDurationSeconds !== "number") return null;
  if (typeof obj.model !== "string") return null;
  if (obj.language !== undefined && typeof obj.language !== "string") return null;
  if (obj.provider !== undefined && obj.provider !== "fal" && obj.provider !== "local") return null;
  const words = parseWords(obj.words);
  if (words === null) return null;
  const segments = parseSegments(obj.segments);
  if (segments === null) return null;
  return {
    text: obj.text,
    language: obj.language as string | undefined,
    sourceDurationSeconds: obj.sourceDurationSeconds,
    model: obj.model,
    provider: obj.provider as "fal" | "local" | undefined,
    words,
    segments,
  };
}

function parseWords(value: unknown): TranscriptionWord[] | null {
  if (!Array.isArray(value)) return null;
  const words: TranscriptionWord[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const w = item as Record<string, unknown>;
    if (typeof w.text !== "string") return null;
    if (w.start !== undefined && typeof w.start !== "number") return null;
    if (w.end !== undefined && typeof w.end !== "number") return null;
    if (w.speaker !== undefined && typeof w.speaker !== "string") return null;
    words.push({
      text: w.text,
      start: w.start as number | undefined,
      end: w.end as number | undefined,
      speaker: w.speaker as string | undefined,
    });
  }
  return words;
}

function parseSegments(value: unknown): TranscriptionSegment[] | null {
  if (!Array.isArray(value)) return null;
  const segments: TranscriptionSegment[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const s = item as Record<string, unknown>;
    if (typeof s.text !== "string") return null;
    if (typeof s.start !== "number") return null;
    if (typeof s.end !== "number") return null;
    if (s.speaker !== undefined && typeof s.speaker !== "string") return null;
    segments.push({ text: s.text, start: s.start, end: s.end, speaker: s.speaker as string | undefined });
  }
  return segments;
}
