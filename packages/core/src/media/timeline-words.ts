import { type Clip, clipEndFrame, clipTimelineFrame } from "../clip.js";
import type { Timeline } from "../timeline.js";
import type { TranscriptionResult } from "./transcript.js";

export interface TimelineWord {
  index: number;
  text: string;
  startFrame: number;
  endFrame: number;
  clipId: string;
  trackIndex: number;
  speaker?: string;
}

/**
 * Swift EditorViewModel+Captions.captionTargets(in:): every audio/video clip, minus video clips
 * whose linked audio clip (shared linkGroupId) is also present on the timeline. Deviation: Swift
 * also drops clips via captionCanTranscribe (asset lookup: video without an audio track isn't
 * transcribable) — this signature has no MediaManifest to check that, so it's the caller's job.
 */
export function transcriptTargets(timeline: Timeline): { clip: Clip; trackIndex: number }[] {
  const pool: { clip: Clip; trackIndex: number }[] = [];
  timeline.tracks.forEach((track, trackIndex) => {
    for (const clip of track.clips) {
      if (clip.mediaType === "audio" || clip.mediaType === "video") pool.push({ clip, trackIndex });
    }
  });
  const linkGroupsWithAudio = new Set(
    pool
      .filter((p) => p.clip.mediaType === "audio" && p.clip.linkGroupId !== undefined)
      .map((p) => p.clip.linkGroupId as string),
  );
  return pool
    .filter(({ clip }) => {
      if (clip.mediaType !== "video" || clip.linkGroupId === undefined) return true;
      return !linkGroupsWithAudio.has(clip.linkGroupId);
    })
    .sort((a, b) => a.clip.startFrame - b.clip.startFrame);
}

/**
 * Maps one clip's transcript words into project frames via the existing clipTimelineFrame:
 * a word whose start falls outside the clip's visible window (null) is dropped, along with
 * timestampless words; a word whose mapped end would land outside the window is clamped to
 * clipEndFrame instead of dropped.
 */
export function clipTimelineWords(
  clip: Clip,
  trackIndex: number,
  transcript: TranscriptionResult,
  fps: number,
): Omit<TimelineWord, "index">[] {
  const words: Omit<TimelineWord, "index">[] = [];
  for (const w of transcript.words) {
    if (w.start === undefined || w.end === undefined) continue;
    const startFrame = clipTimelineFrame(clip, w.start, fps);
    if (startFrame === null) continue;
    const mappedEnd = clipTimelineFrame(clip, w.end, fps);
    const endFrame = Math.max(startFrame, mappedEnd ?? clipEndFrame(clip));
    words.push({ text: w.text, startFrame, endFrame, clipId: clip.id, trackIndex, speaker: w.speaker });
  }
  return words.sort((a, b) => a.startFrame - b.startFrame || a.endFrame - b.endFrame);
}

/**
 * Concatenates per-clip word lists into one global, stably-indexed list. Each clip's words stay
 * contiguous (their blocks are ordered by the clip's leading word startFrame, then trackIndex) —
 * this mirrors Swift's fragments-sorted-by-clip.startFrame concatenation, which downstream
 * grouping (by consecutive clipId) depends on.
 */
export function assembleTimelineWords(perClip: Omit<TimelineWord, "index">[][]): TimelineWord[] {
  const ordered = [...perClip].sort((a, b) => {
    const aw = a[0];
    const bw = b[0];
    if (!aw || !bw) return 0;
    return aw.startFrame - bw.startFrame || aw.trackIndex - bw.trackIndex;
  });
  return ordered.flat().map((w, index) => ({ ...w, index }));
}
