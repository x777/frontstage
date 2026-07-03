import type { ClipType } from "./clip-type.js";
import { type Clip, clipEndFrame } from "./clip.js";

export interface Track {
  id: string;
  type: ClipType;
  muted: boolean;
  hidden: boolean;
  syncLocked: boolean;
  displayHeight?: number;
  clips: Clip[];
}

export interface Timeline {
  fps: number;
  width: number;
  height: number;
  settingsConfigured: boolean;
  tracks: Track[];
}

export interface ClipLocation {
  trackIndex: number;
  clipIndex: number;
}

export function defaultTimeline(): Timeline {
  return { fps: 30, width: 1920, height: 1080, settingsConfigured: false, tracks: [] };
}

export function trackEndFrame(track: Track): number {
  let maxFrame = 0;
  for (const clip of track.clips) maxFrame = Math.max(maxFrame, clipEndFrame(clip));
  return maxFrame;
}

export function timelineTotalFrames(t: Timeline): number {
  let maxFrame = 0;
  for (const track of t.tracks) maxFrame = Math.max(maxFrame, trackEndFrame(track));
  return maxFrame;
}

/** Unique mediaRefs in first-appearance order — the set an interop export needs timecodes for. */
export function timelineMediaRefs(t: Timeline): string[] {
  const seen = new Set<string>();
  const refs: string[] = [];
  for (const track of t.tracks) {
    for (const clip of track.clips) {
      if (seen.has(clip.mediaRef)) continue;
      seen.add(clip.mediaRef);
      refs.push(clip.mediaRef);
    }
  }
  return refs;
}

export function findClip(t: Timeline, id: string): ClipLocation | null {
  for (let ti = 0; ti < t.tracks.length; ti++) {
    const ci = t.tracks[ti]!.clips.findIndex((c) => c.id === id);
    if (ci !== -1) return { trackIndex: ti, clipIndex: ci };
  }
  return null;
}

export function contiguousClipIds(track: Track, fromEnd: number, excludeId: string): Set<string> {
  const ids = new Set<string>();
  let chainEnd = fromEnd;
  const sorted = [...track.clips].sort((a, b) => a.startFrame - b.startFrame);
  for (const c of sorted) {
    if (c.id === excludeId || c.startFrame < fromEnd) continue;
    if (c.startFrame !== chainEnd) break;
    chainEnd = clipEndFrame(c);
    ids.add(c.id);
  }
  return ids;
}
