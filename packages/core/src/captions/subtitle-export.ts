import type { Clip } from "../clip.js";
import type { TranscriptionResult } from "../media/transcript.js";
import type { Timeline } from "../timeline.js";

export interface SubtitleCue {
  startSec: number;
  endSec: number;
  text: string;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

function formatTimestamp(seconds: number, msSeparator: "," | "."): string {
  const totalMs = Math.round(Math.max(0, seconds) * 1000);
  const ms = totalMs % 1000;
  const totalSec = Math.floor(totalMs / 1000);
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}${msSeparator}${pad(ms, 3)}`;
}

// Zero/negative-duration cues (a glitchy transcript segment, or a degenerate span) are dropped
// rather than clamped — VTT requires end > start, and a dropped cue is simpler to reason about
// than a synthetic 1ms one.
function positiveDuration(cue: SubtitleCue): boolean {
  return cue.endSec > cue.startSec;
}

// SRT is a CRLF-discipline format throughout; a bare LF surviving inside multi-line cue text
// (e.g. from a user-edited caption clip) would otherwise break that discipline mid-block.
function toCrlf(text: string): string {
  return text.replace(/\r\n|\r|\n/g, "\r\n");
}

/** 1-based index blocks, "," ms separator, CRLF endings, blank line between blocks. */
export function formatSrt(cues: SubtitleCue[]): string {
  const blocks = cues.filter(positiveDuration).map((cue, i) => {
    const range = `${formatTimestamp(cue.startSec, ",")} --> ${formatTimestamp(cue.endSec, ",")}`;
    return `${i + 1}\r\n${range}\r\n${toCrlf(cue.text)}\r\n`;
  });
  return blocks.join("\r\n");
}

/** "WEBVTT" header, "." ms separator, LF endings, blank line between blocks. */
export function formatVtt(cues: SubtitleCue[]): string {
  const blocks = cues.filter(positiveDuration).map((cue) => {
    const range = `${formatTimestamp(cue.startSec, ".")} --> ${formatTimestamp(cue.endSec, ".")}`;
    return `${range}\n${cue.text}\n`;
  });
  return `WEBVTT\n\n${blocks.join("\n")}`;
}

/** Transcript segments -> cues, dropping segments whose text is blank. */
export function cuesFromTranscript(result: TranscriptionResult): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  for (const seg of result.segments) {
    const text = seg.text.trim();
    if (text.length === 0) continue;
    cues.push({ startSec: seg.start, endSec: seg.end, text });
  }
  return cues;
}

/** Every clip with a captionGroupId, across all tracks, in chronological (startFrame) order. */
export function cuesFromCaptionClips(timeline: Timeline, fps: number): SubtitleCue[] {
  const clips: Clip[] = [];
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      if (clip.captionGroupId !== undefined) clips.push(clip);
    }
  }
  clips.sort((a, b) => a.startFrame - b.startFrame);

  const cues: SubtitleCue[] = [];
  for (const clip of clips) {
    // Mirrors cuesFromTranscript: an empty/whitespace-only caption clip yields no cue at all,
    // rather than an empty text line inside an otherwise-valid SRT/VTT block.
    const text = clip.textContent?.trim();
    if (!text) continue;
    cues.push({ startSec: clip.startFrame / fps, endSec: (clip.startFrame + clip.durationFrames) / fps, text });
  }
  return cues;
}
