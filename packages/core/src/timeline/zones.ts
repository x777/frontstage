import type { Timeline } from "../timeline.js";
import type { ClipType } from "../clip-type.js";

// Visual/audio track partition: visual [0,firstAudioIndex), audio [firstAudioIndex,trackCount). Mirrors Swift ZoneLayout.
export interface ZoneLayout {
  trackCount: number;
  firstAudioIndex: number;
}

export function computeZones(timeline: Timeline): ZoneLayout {
  const trackCount = timeline.tracks.length;
  const idx = timeline.tracks.findIndex((t) => t.type === "audio");
  return { trackCount, firstAudioIndex: idx === -1 ? trackCount : idx };
}

export function videoTrackCount(z: ZoneLayout): number {
  return z.firstAudioIndex;
}

export function audioTrackCount(z: ZoneLayout): number {
  return z.trackCount - z.firstAudioIndex;
}

// Clamp a requested insertion index into the track's type zone (visual before the divider, audio after).
export function partitionedInsertionIndex(zones: ZoneLayout, type: ClipType, requested: number): number {
  const bounded = Math.max(0, Math.min(requested, zones.trackCount));
  return type === "audio"
    ? Math.max(bounded, zones.firstAudioIndex)
    : Math.min(bounded, zones.firstAudioIndex);
}

// First audio track with no clip overlapping [startFrame, startFrame + duration), else null.
export function availableAudioTrackIndex(timeline: Timeline, startFrame: number, duration: number): number | null {
  const z = computeZones(timeline);
  const end = startFrame + duration;
  for (let i = z.firstAudioIndex; i < z.trackCount; i++) {
    const track = timeline.tracks[i]!;
    const conflicts = track.clips.some((c) => !(c.startFrame + c.durationFrames <= startFrame || c.startFrame >= end));
    if (!conflicts) return i;
  }
  return null;
}
