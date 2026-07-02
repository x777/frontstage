// fal-ai/whisper result shaping — isolated per the M11A pattern (all fal specifics stay in wire
// modules). whisper was chosen over wizper (VERIFIED against fal's openapi.json, 2026-07:
// https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai/whisper) specifically because
// its chunk_level is a real enum ["none","segment","word"] — wizper's is `const:"segment"`, so
// word-level chunks aren't offered there at all. With chunk_level:"word" (see gen-catalog.ts's
// buildInput), each WhisperChunk IS one word: chunks map directly to TranscriptionWord[], and
// TranscriptionSegment[] is derived from those words by grouping on sentence punctuation. Note the
// output's language array is called `inferred_languages` here (wizper's was `languages`).
import type { TranscriptionResult, TranscriptionSegment, TranscriptionWord } from "@palmier/core";

interface WhisperChunk {
  text: string;
  start: number | null;
  end: number | null;
}

function parseChunk(value: unknown): WhisperChunk | null {
  if (typeof value !== "object" || value === null) return null;
  const c = value as Record<string, unknown>;
  if (typeof c.text !== "string") return null;
  const ts = c.timestamp;
  if (!Array.isArray(ts) || ts.length !== 2) return null;
  const start = typeof ts[0] === "number" ? ts[0] : null;
  const end = typeof ts[1] === "number" ? ts[1] : null;
  return { text: c.text, start, end };
}

/**
 * Converts one chunk into word(s). The normal case (chunk_level:"word" honored) is a single
 * whitespace token per chunk. FALLBACK: if a chunk's text carries more than one token, the
 * payload was actually segment-level (e.g. chunk_level got reverted upstream) — rather than
 * crash or drop it, evenly split the chunk's [start,end] span across its tokens, adapting the
 * same even-split approximation the old wizper mapping used for every word.
 */
function chunkToWords(chunk: WhisperChunk): TranscriptionWord[] {
  const parts = chunk.text.trim().split(/\s+/).filter((w) => w.length > 0);
  if (parts.length === 0) return [];
  if (parts.length === 1) {
    return [{ text: parts[0]!, start: chunk.start ?? undefined, end: chunk.end ?? undefined }];
  }

  const { start, end } = chunk;
  if (start === null || end === null) {
    // No usable span to split — keep the words, just without fabricated timing.
    return parts.map((text) => ({ text, start: undefined, end: undefined }));
  }
  const span = Math.max(0, end - start);
  const step = span / parts.length;
  return parts.map((text, i) => ({ text, start: start + i * step, end: start + (i + 1) * step }));
}

/** Parses a fal-ai/whisper result payload (WhisperOutput) into the core TranscriptionResult shape. */
export function parseWhisperResult(json: unknown): TranscriptionResult {
  const obj = json !== null && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const text = typeof obj.text === "string" ? obj.text : "";
  const inferredLanguages = Array.isArray(obj.inferred_languages) ? obj.inferred_languages : [];
  const language = typeof inferredLanguages[0] === "string" ? (inferredLanguages[0] as string) : undefined;

  const rawChunks = Array.isArray(obj.chunks) ? obj.chunks : [];
  const words: TranscriptionWord[] = [];
  for (const raw of rawChunks) {
    const chunk = parseChunk(raw);
    if (!chunk) continue; // malformed chunk — skip, never throw
    words.push(...chunkToWords(chunk));
  }

  return { text, language, words, segments: deriveSegments(words) };
}

const SENTENCE_END = /[.!?]$/;
const SEGMENT_WORD_CAP = 30; // guard against a runaway segment when the audio has no punctuation

/**
 * Groups words into segments, splitting after a word ending in sentence punctuation (or once a
 * segment hits the word cap). A segment's [start,end] comes from its first/last TIMESTAMPED word
 * (leading/trailing timestampless words are still included in the text, just not the bounds); a
 * segment with no timestamped words at all is dropped rather than emitted with fabricated bounds.
 */
export function deriveSegments(words: TranscriptionWord[]): TranscriptionSegment[] {
  const segments: TranscriptionSegment[] = [];
  let group: TranscriptionWord[] = [];

  const flush = () => {
    if (group.length === 0) return;
    const timestamped = group.filter((w) => w.start !== undefined && w.end !== undefined);
    if (timestamped.length > 0) {
      segments.push({
        text: group.map((w) => w.text).join(" "),
        start: timestamped[0]!.start!,
        end: timestamped[timestamped.length - 1]!.end!,
      });
    }
    group = [];
  };

  for (const word of words) {
    group.push(word);
    if (SENTENCE_END.test(word.text.trim()) || group.length >= SEGMENT_WORD_CAP) flush();
  }
  flush();

  return segments;
}
