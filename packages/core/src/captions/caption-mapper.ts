import { type Clip, clipEndFrame, clipTimelineFrame } from "../clip.js";
import type { TranscriptionResult } from "../media/transcript.js";
import type { CaptionPhrase } from "./caption-builder.js";

export interface CaptionWordTiming {
  text: string;
  /** Clip-relative frame (relative to the CAPTION clip's own startFrame, not the timeline origin). */
  startFrame: number;
  endFrame: number;
}

export interface CaptionClipSpec {
  content: string;
  /** Timeline (project) frame — where the caption clip is placed. */
  startFrame: number;
  durationFrames: number;
  wordTimings: CaptionWordTiming[];
}

/** Swift: `CaptionTranscriptMapper.sourceSpan(for:)` — the clip's visible window in SOURCE frames. */
function sourceSpan(clip: Clip): { start: number; end: number } {
  const start = clip.trimStartFrame;
  return { start, end: start + clip.durationFrames * Math.max(clip.speed, 0.0001) };
}

/**
 * Gives each phrase a floor duration without moving later phrases off their first word. Exact port
 * of Swift's `CaptionBuilder.enforceMinDuration`; ported here (rather than in caption-builder.ts)
 * per the task interface — see buildCaptionPhrases' docstring for why. `phrases` must be in
 * chronological order; the last phrase has no next-phrase ceiling and extends freely (its mapped
 * frame span then gets clamped to the clip's own end by the frame math below).
 */
function enforceMinDuration(phrases: CaptionPhrase[], minDuration: number): CaptionPhrase[] {
  const out = phrases.map((p) => ({ ...p }));
  for (let i = 0; i < out.length; i++) {
    const p = out[i]!;
    const targetEnd = Math.max(p.endSec, p.startSec + minDuration);
    if (i + 1 < out.length) {
      p.endSec = Math.min(targetEnd, out[i + 1]!.startSec);
      if (p.endSec < p.startSec) p.endSec = p.startSec;
    } else {
      p.endSec = targetEnd;
    }
  }
  return out;
}

/**
 * Places built phrases onto one clip's timeline span, converting source-seconds to the clip's
 * timeline frames via `clipTimelineFrame`/`clipEndFrame` (trim + speed), and word timings to
 * frames CLIP-RELATIVE (relative to the caption clip's own startFrame — Swift's `WordTiming` is
 * clip-relative the same way, read by `TextFrameRenderer` per clip). Phrases that don't overlap
 * the clip's visible source window are dropped; a phrase that overlaps but straddles the window
 * edge is clamped, not dropped. `trackIndex` is accepted for signature parity with Swift's
 * `CaptionBuilder.specs(trackIndex:)` but unused here — CaptionClipSpec carries no trackIndex
 * because Task 4's placeCaptionsCommand always places every produced spec on the single new track
 * it inserts.
 */
export function captionSpecsForClip(
  clip: Clip,
  trackIndex: number,
  phrases: CaptionPhrase[],
  fps: number,
  minDisplaySec = 0.7,
): CaptionClipSpec[] {
  void trackIndex;
  const floored = enforceMinDuration(phrases, minDisplaySec);
  const visible = sourceSpan(clip);
  const clipEnd = clipEndFrame(clip);

  const clampedTimelineFrame = (sourceSeconds: number): number => {
    const sourceFrame = sourceSeconds * fps;
    const offsetFromTrim = sourceFrame - visible.start;
    const frame = Math.round(clip.startFrame + offsetFromTrim / Math.max(clip.speed, 0.0001));
    return Math.min(Math.max(frame, clip.startFrame), clipEnd);
  };

  const specs: CaptionClipSpec[] = [];
  for (const p of floored) {
    const phraseStartSource = p.startSec * fps;
    const phraseEndSource = p.endSec * fps;
    if (!(phraseEndSource > visible.start && phraseStartSource < visible.end)) continue;

    const mappedStart = clipTimelineFrame(clip, p.startSec, fps);
    const mappedEnd = clipTimelineFrame(clip, p.endSec, fps);
    const s = mappedStart ?? clip.startFrame;
    const e = mappedEnd ?? clipEnd;
    const durationFrames = Math.max(1, Math.min(clipEnd, e) - Math.max(clip.startFrame, s));

    const wordTimings: CaptionWordTiming[] = [];
    let droppedWords = false;
    for (const w of p.words) {
      const wordStartSource = w.startSec * fps;
      const wordEndSource = w.endSec * fps;
      if (!(wordEndSource > visible.start && wordStartSource < visible.end)) { droppedWords = true; continue; }
      const ws = clampedTimelineFrame(w.startSec);
      const we = clampedTimelineFrame(w.endSec);
      const rs = Math.min(Math.max(0, ws - s), durationFrames);
      const re = Math.min(Math.max(rs, we - s), durationFrames);
      if (!(re > rs)) { droppedWords = true; continue; }
      wordTimings.push({ text: w.text, startFrame: rs, endFrame: re });
    }

    // When edge words drop, rebuild content from the kept words: the renderer requires
    // content word count == wordTimings length, else it falls back to a static raster.
    const content = droppedWords && wordTimings.length > 0 ? wordTimings.map((w) => w.text).join(" ") : p.text;
    specs.push({ content, startFrame: s, durationFrames, wordTimings });
  }
  return specs;
}

/** Swift: `CaptionTranscriptMapper.spokenWordCount(in:result:fps:)` — words whose source-seconds
 * midpoint falls inside the clip's visible source window. */
function spokenWordCount(clip: Clip, result: TranscriptionResult, fps: number): number {
  const visible = sourceSpan(clip);
  let count = 0;
  for (const word of result.words) {
    if (word.start === undefined || word.end === undefined) continue;
    const midFrame = ((word.start + word.end) / 2) * fps;
    if (midFrame >= visible.start && midFrame < visible.end) count += 1;
  }
  return count;
}

/**
 * The track with the most spoken words landing inside its clips' visible windows, or null if none
 * have any. Swift keys this by track id and breaks ties via `Dictionary.max(by:)` over unordered
 * dictionary iteration — effectively unspecified. This port keys by trackIndex and breaks ties
 * deterministically in favor of the LOWEST trackIndex (first strictly-greater count wins, matching
 * `max(by:)`'s "replace only on strictly greater" rule, applied in ascending trackIndex order).
 * `fps` isn't in the task brief's signature but is required by the underlying frame-midpoint math
 * (Swift closes over `timeline.fps`) — added here as a necessary parameter.
 */
export function dominantSpeechTrack(
  targets: { clip: Clip; trackIndex: number }[],
  transcriptsByRef: Map<string, TranscriptionResult>,
  fps: number,
): number | null {
  const wordsByTrack = new Map<number, number>();
  for (const t of targets) {
    const result = transcriptsByRef.get(t.clip.mediaRef);
    if (!result) continue;
    const count = spokenWordCount(t.clip, result, fps);
    wordsByTrack.set(t.trackIndex, (wordsByTrack.get(t.trackIndex) ?? 0) + count);
  }

  const trackIndices = [...wordsByTrack.keys()].sort((a, b) => a - b);
  let winner: number | null = null;
  let winnerCount = 0;
  for (const trackIndex of trackIndices) {
    const count = wordsByTrack.get(trackIndex)!;
    if (count > 0 && count > winnerCount) {
      winner = trackIndex;
      winnerCount = count;
    }
  }
  return winner;
}
