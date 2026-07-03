import { splitTextWords } from "../text-animation.js";
import type { TranscriptionSegment, TranscriptionWord } from "../media/transcript.js";

/**
 * A caption-sized chunk of transcript text, timed in source-media seconds (the same timebase as
 * the input segments/words — no clip/frame mapping here; see caption-mapper.ts for that).
 */
export interface CaptionPhrase {
  text: string;
  startSec: number;
  endSec: number;
  /** Member words with their own timings; empty when word-level timing wasn't available. */
  words: CaptionWordSpan[];
}

export interface CaptionWordSpan {
  text: string;
  startSec: number;
  endSec: number;
}

/**
 * Character-count text-width fallback (fraction of `canvasWidth`), used when no real text
 * measurement is available. The ONE shared home for this heuristic: @palmier/ai's add_captions
 * tool and @palmier/ui's measureCaptionWidthFrac both call it, so the fallback is byte-identical
 * on either side of the M11D facade wiring (core is the only package both already depend on).
 */
export function heuristicCaptionWidthFrac(text: string, fontSize: number, canvasWidth: number): number {
  return (text.length * fontSize * 0.55) / canvasWidth;
}

export interface BuildCaptionPhrasesOptions {
  /**
   * Returns the rendered width of `text` (at the caption's font/size) as a FRACTION of the canvas
   * width — e.g. 0.42 means the text would occupy 42% of the canvas. The caller bakes the text
   * style into this closure (Swift: `EditorViewModel.captionLineFits` measures via `TextLayout`
   * against `timeline.width`); this module only ever compares `measure(text)` to `maxWidthFrac`.
   */
  measure(text: string): number;
  /** Swift: `AppTheme.ComponentSize.captionPreviewMaxTextWidthRatio`. */
  maxWidthFrac?: number;
  maxWords?: number;
}

/**
 * Builds caption phrases from a transcript's segments and words. Callers are expected to have
 * already windowed `segments`/`words` to whatever span should become captions (e.g. via
 * `filterTranscript` scoped to a clip's visible source range) — unlike Swift's
 * `CaptionTranscriptMapper`, this function has no notion of a clip; that's caption-mapper.ts's job
 * (`captionSpecsForClip`), which also applies the 0.7s minimum-display floor. Swift applies that
 * floor here (inside `CaptionBuilder.phrases`); moving it downstream is a deliberate deviation so
 * this module stays clip-agnostic per the task interface.
 */
export function buildCaptionPhrases(
  segments: TranscriptionSegment[],
  words: TranscriptionWord[],
  opts: BuildCaptionPhrasesOptions,
): CaptionPhrase[] {
  const maxWidthFrac = opts.maxWidthFrac ?? 0.9;
  const fits = (t: string): boolean => opts.measure(t) <= maxWidthFrac;
  const hasWordTimings = words.some((w) => w.start !== undefined && w.end !== undefined);

  if (hasWordTimings) return phrasesWithWordTimings(segments, words, fits, opts.maxWords);

  const phrases: CaptionPhrase[] = [];
  for (const segment of segments) {
    if (segment.end <= segment.start) continue;
    phrases.push(...phrasesForSegment(segment, [], fits, opts.maxWords));
  }
  return phrases;
}

/**
 * Exact port of Swift's `CaptionTranscriptMapper.phrasesWithWordTimings`: walks segments in order
 * with a single forward `wordIndex` pointer over `words` (assumed sorted by time), assigning each
 * word to the first segment whose [start, end) contains its midpoint, then splitting each
 * segment's word run independently via `phrasesFromTimedWords`.
 */
function phrasesWithWordTimings(
  segments: TranscriptionSegment[],
  words: TranscriptionWord[],
  fits: (t: string) => boolean,
  maxWords: number | undefined,
): CaptionPhrase[] {
  const segs = segments.length > 0 ? segments : [fallbackSegmentFromWords(words)];
  const phrases: CaptionPhrase[] = [];
  let wordIndex = 0;

  for (const segment of segs) {
    while (wordIndex < words.length) {
      const w = words[wordIndex]!;
      if (w.start === undefined || w.end === undefined) {
        wordIndex += 1;
        continue;
      }
      if ((w.start + w.end) / 2 < segment.start) {
        wordIndex += 1;
        continue;
      }
      break;
    }

    let i = wordIndex;
    const segmentWords: TranscriptionWord[] = [];
    while (i < words.length) {
      const w = words[i]!;
      if (w.start === undefined || w.end === undefined) {
        i += 1;
        continue;
      }
      const mid = (w.start + w.end) / 2;
      if (mid >= segment.end) break;
      if (mid >= segment.start) segmentWords.push(w);
      i += 1;
    }

    if (segmentWords.length === 0) continue;
    phrases.push(...phrasesFromTimedWords(segmentWords, fits, maxWords));
  }
  return phrases;
}

/** Swift's `fallbackSegment(for:)`: a single segment spanning the words' extent. Its `text` field
 * is never read downstream (phrasesFromTimedWords builds text from the words themselves). */
function fallbackSegmentFromWords(words: TranscriptionWord[]): TranscriptionSegment {
  const starts = words.map((w) => w.start).filter((s): s is number => s !== undefined);
  const ends = words.map((w) => w.end).filter((e): e is number => e !== undefined);
  const start = starts.length > 0 ? Math.min(...starts) : 0;
  const end = ends.length > 0 ? Math.max(...ends) : start;
  return { text: "", start, end };
}

function wordCount(text: string): number {
  return splitTextWords(text).length;
}

/** Swift's general `CaptionBuilder.phrases(for:words:fits:maxWords:minDuration:)`, minus the
 * minDuration floor (moved to caption-mapper.ts's captionSpecsForClip). */
function phrasesForSegment(
  segment: Pick<TranscriptionSegment, "text" | "start" | "end">,
  words: TranscriptionWord[],
  fits: (t: string) => boolean,
  maxWords: number | undefined,
): CaptionPhrase[] {
  const cap = maxWords !== undefined ? Math.max(1, maxWords) : undefined;
  const pieces =
    cap !== undefined ? splitText(segment.text, (t) => fits(t) && wordCount(t) <= cap) : splitText(segment.text, fits);
  return timePieces(pieces, segment, words);
}

/** Swift's `CaptionBuilder.phrases(fromTimedWords:fits:maxWords:minDuration:)`, minus the floor. */
function phrasesFromTimedWords(
  words: TranscriptionWord[],
  fits: (t: string) => boolean,
  maxWords: number | undefined,
): CaptionPhrase[] {
  const timed = words.filter((w) => w.start !== undefined && w.end !== undefined);
  const first = timed[0];
  const last = timed[timed.length - 1];
  if (!first || !last || first.start === undefined || last.end === undefined || last.end <= first.start) return [];
  const text = timed
    .map((w) => w.text)
    .join(" ")
    .trim();
  if (text.length === 0) return [];
  return phrasesForSegment({ text, start: first.start, end: last.end }, timed, fits, maxWords);
}

/** Split once at the best boundary present: sentence, then clause, then midpoint word. */
function breakOnce(text: string): string[] {
  return breakOn(text, ".!?") ?? breakOn(text, ",;:") ?? breakAtMidWord(text);
}

/** Split after delimiters followed by a space, so "U.S." and "3.14" stay intact. */
function breakOn(text: string, delimiters: string): string[] | null {
  const set = new Set(delimiters);
  const chars = Array.from(text);
  const pieces: string[] = [];
  let current = "";
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]!;
    current += c;
    const nextIsBreak = i + 1 >= chars.length || chars[i + 1] === " ";
    if (set.has(c) && nextIsBreak) {
      const piece = current.trim();
      if (piece.length > 0) pieces.push(piece);
      current = "";
    }
  }
  const tail = current.trim();
  if (tail.length > 0) pieces.push(tail);
  return pieces.length > 1 ? pieces : null;
}

function breakAtMidWord(text: string): string[] {
  const words = text.split(" ").filter((w) => w.length > 0);
  if (words.length <= 1) return [text];
  const mid = Math.floor(words.length / 2);
  return [words.slice(0, mid).join(" "), words.slice(mid).join(" ")];
}

/** Recursive split: a piece that fits (or can't be broken further) stops; otherwise splits once
 * at the best boundary and recurses on each half. A single over-long word is kept as-is. */
function splitText(text: string, fits: (t: string) => boolean): string[] {
  const t = text.trim();
  if (t.length === 0) return [];
  if (fits(t)) return [t];
  const parts = breakOnce(t);
  if (parts.length <= 1) return [t];
  return parts.flatMap((p) => splitText(p, fits));
}

/** Counts letters/numbers only — the shared basis `timePieces` uses to align split text pieces
 * back to the word run that produced them (punctuation-insensitive, so splitting mid-punctuation
 * doesn't throw off the count). */
function alphanumericCount(text: string): number {
  let count = 0;
  for (const ch of text) {
    if (/[\p{L}\p{N}]/u.test(ch)) count += 1;
  }
  return count;
}

/**
 * Times phrases from word runs by matching shared alphanumeric-character counts, so timing holds
 * when runs don't split on spaces (contractions, split numbers, punctuation runs). Falls back to
 * `distribute` when there's no usable word timing, or when the character-count walk didn't land
 * on exactly one span per piece (Swift: same fallback guard).
 */
function timePieces(
  texts: string[],
  segment: Pick<TranscriptionSegment, "start" | "end">,
  words: TranscriptionWord[],
): CaptionPhrase[] {
  const timed = words
    .filter((w) => w.start !== undefined && w.end !== undefined && alphanumericCount(w.text) > 0)
    .map((w) => ({ text: w.text, count: alphanumericCount(w.text), start: w.start as number, end: w.end as number }));

  if (timed.length === 0) return distribute(texts, segment.start, segment.end);

  const phrases: CaptionPhrase[] = [];
  let idx = 0;
  for (const text of texts) {
    const want = alphanumericCount(text);
    let got = 0;
    let first: { start: number; end: number } | undefined;
    let last: { start: number; end: number } | undefined;
    const spans: CaptionWordSpan[] = [];
    while (idx < timed.length && got < want) {
      const run = timed[idx]!;
      if (!first) first = { start: run.start, end: run.end };
      last = { start: run.start, end: run.end };
      spans.push({ text: run.text.trim(), startSec: run.start, endSec: run.end });
      got += run.count;
      idx += 1;
    }
    if (!first || !last) break;
    phrases.push({ text, startSec: first.start, endSec: last.end, words: spans });
  }
  return phrases.length === texts.length ? phrases : distribute(texts, segment.start, segment.end);
}

/** Shares the segment's time across pieces by character count, back to back. */
function distribute(texts: string[], start: number, end: number): CaptionPhrase[] {
  if (texts.length === 0) return [];
  const lengths = texts.map((t) => Math.max(Array.from(t).length, 1));
  const total = lengths.reduce((a, b) => a + b, 0);
  const span = Math.max(end - start, 0);
  const phrases: CaptionPhrase[] = [];
  let t = start;
  for (let i = 0; i < texts.length; i++) {
    const dur = (span * lengths[i]!) / total;
    phrases.push({ text: texts[i]!, startSec: t, endSec: t + dur, words: [] });
    t += dur;
  }
  return phrases;
}
