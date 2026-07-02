// fal-ai/wizper result shaping — isolated per the M11A pattern (all fal specifics stay in wire
// modules). VERIFIED against fal's openapi.json (https://fal.ai/api/openapi/queue/openapi.json?
// endpoint_id=fal-ai/wizper) 2026-07: this corrects the M11A design brief's assumption.
//
// DEVIATION (verified, not assumed): the brief expected `chunk_level:"word"` to yield word-level
// chunks, with segments then derived by punctuation-grouping. The real WizperInput schema marks
// chunk_level `const:"segment"` — word-level chunking isn't offered by this endpoint at all, and
// WhisperChunk carries only a single [start,end] timestamp per chunk, no nested word timings.
// So the mapping runs the OPPOSITE direction from the plan: chunks map directly to SEGMENTS (each
// a natural Whisper utterance, bounded by max_segment_len=29s — see gen-catalog.ts's buildInput,
// which also sets merge_chunks:false to keep the finest natural granularity fal offers); WORDS are
// then derived per segment by an even time-split. Swift's native providers return real word
// timings — this is the one structural gap wizper doesn't close.
import type { TranscriptionResult, TranscriptionSegment, TranscriptionWord } from "@palmier/core";

interface WizperChunk {
  text: string;
  start: number | null;
  end: number | null;
}

function parseChunk(value: unknown): WizperChunk | null {
  if (typeof value !== "object" || value === null) return null;
  const c = value as Record<string, unknown>;
  if (typeof c.text !== "string") return null;
  const ts = c.timestamp;
  if (!Array.isArray(ts) || ts.length !== 2) return null;
  const start = typeof ts[0] === "number" ? ts[0] : null;
  const end = typeof ts[1] === "number" ? ts[1] : null;
  return { text: c.text, start, end };
}

/** Parses a fal-ai/wizper result payload (WhisperOutput) into the core TranscriptionResult shape. */
export function parseWizperResult(json: unknown): TranscriptionResult {
  const obj = json !== null && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const text = typeof obj.text === "string" ? obj.text : "";
  const languages = Array.isArray(obj.languages) ? obj.languages : [];
  const language = typeof languages[0] === "string" ? (languages[0] as string) : undefined;

  const rawChunks = Array.isArray(obj.chunks) ? obj.chunks : [];
  const segments: TranscriptionSegment[] = [];
  for (const raw of rawChunks) {
    const chunk = parseChunk(raw);
    if (!chunk || chunk.start === null || chunk.end === null) continue; // no usable span — drop
    const trimmed = chunk.text.trim();
    if (trimmed.length === 0) continue;
    segments.push({ text: trimmed, start: chunk.start, end: chunk.end });
  }

  return { text, language, words: deriveWords(segments), segments };
}

/**
 * Derives per-word timing from segment-level timing: an even time-split of each segment's
 * whitespace-delimited words across its [start,end] span. wizper carries no native word timing
 * (see the module doc), so this is a documented approximation, not a measurement.
 */
export function deriveWords(segments: TranscriptionSegment[]): TranscriptionWord[] {
  const words: TranscriptionWord[] = [];
  for (const seg of segments) {
    const parts = seg.text.split(/\s+/).filter((w) => w.length > 0);
    if (parts.length === 0) continue;
    const span = Math.max(0, seg.end - seg.start);
    const step = span / parts.length;
    parts.forEach((text, i) => {
      words.push({ text, start: seg.start + i * step, end: seg.start + (i + 1) * step });
    });
  }
  return words;
}
