import type { Timeline } from "../timeline.js";
import type { TrackDropTarget } from "./geometry.js";
import { computeZones, audioTrackCount } from "./zones.js";

export function topVisualTrackIndex(timeline: Timeline): number | null {
  return computeZones(timeline).firstAudioIndex > 0 ? 0 : null;
}

export function resolveVisualDropTarget(timeline: Timeline, cursor: TrackDropTarget): TrackDropTarget {
  const z = computeZones(timeline);
  if (z.trackCount === 0) return { kind: "new", index: 0 };
  if (cursor.kind === "existing") {
    const idx = cursor.index;
    if (idx < 0 || idx >= timeline.tracks.length) return { kind: "new", index: 0 };
    if (timeline.tracks[idx]!.type !== "audio") return { kind: "existing", index: idx };
    const distance = idx - z.firstAudioIndex;
    const mirrored = z.firstAudioIndex - 1 - distance;
    if (mirrored >= 0 && mirrored < z.firstAudioIndex) return { kind: "existing", index: mirrored };
    const v = topVisualTrackIndex(timeline);
    return v !== null ? { kind: "existing", index: v } : { kind: "new", index: 0 };
  }
  const insertIdx = cursor.index;
  if (insertIdx <= z.firstAudioIndex) return { kind: "new", index: insertIdx };
  const distance = insertIdx - z.firstAudioIndex;
  return { kind: "new", index: Math.max(0, z.firstAudioIndex - distance) };
}

export function preferredAudioTrack(timeline: Timeline, cursor: TrackDropTarget): number | null {
  if (cursor.kind !== "existing") return null;
  const idx = cursor.index;
  if (idx < 0 || idx >= timeline.tracks.length) return null;
  const z = computeZones(timeline);
  if (audioTrackCount(z) === 0) return null;
  if (timeline.tracks[idx]!.type === "audio") return idx;
  const distanceFromDivider = z.firstAudioIndex - 1 - idx;
  const mirrored = z.firstAudioIndex + distanceFromDivider;
  return mirrored >= z.firstAudioIndex && mirrored < z.trackCount ? mirrored : z.firstAudioIndex;
}

export function resolveAudioDropTarget(timeline: Timeline, cursor: TrackDropTarget): TrackDropTarget {
  const z = computeZones(timeline);
  if (z.trackCount === 0) return { kind: "new", index: 1 };
  if (cursor.kind === "new") {
    const insertIdx = cursor.index;
    if (insertIdx > z.firstAudioIndex) return { kind: "new", index: insertIdx };
    const distance = z.firstAudioIndex - insertIdx;
    const clamped = Math.min(distance, audioTrackCount(z));
    return { kind: "new", index: z.firstAudioIndex + clamped };
  }
  const idx = preferredAudioTrack(timeline, cursor);
  return idx !== null ? { kind: "existing", index: idx } : { kind: "new", index: z.trackCount };
}

export function shiftAfterVisualInsertion(audio: TrackDropTarget, visual: TrackDropTarget): TrackDropTarget {
  if (visual.kind !== "new") return audio;
  const visualInsertIdx = visual.index;
  if (audio.kind === "existing") return audio.index >= visualInsertIdx ? { kind: "existing", index: audio.index + 1 } : audio;
  return audio.index >= visualInsertIdx ? { kind: "new", index: audio.index + 1 } : audio;
}

export interface DropPlan {
  visualTarget: TrackDropTarget | null;
  audioTarget: TrackDropTarget | null;
  visualDurationFrames: number;
  audioOnlyDurationFrames: number;
}

export function resolveDropPlan(
  timeline: Timeline,
  cursor: TrackDropTarget,
  mediaType: "video" | "image" | "audio" | "text" | "lottie",
  hasAudio: boolean,
  durationFrames: number,
): DropPlan {
  if (mediaType === "audio") {
    return { visualTarget: null, audioTarget: resolveAudioDropTarget(timeline, cursor), visualDurationFrames: 0, audioOnlyDurationFrames: durationFrames };
  }
  const visualTarget = resolveVisualDropTarget(timeline, cursor);
  if (mediaType === "video" && hasAudio) {
    const audioTarget = shiftAfterVisualInsertion(resolveAudioDropTarget(timeline, cursor), visualTarget);
    return { visualTarget, audioTarget, visualDurationFrames: durationFrames, audioOnlyDurationFrames: durationFrames };
  }
  return { visualTarget, audioTarget: null, visualDurationFrames: durationFrames, audioOnlyDurationFrames: 0 };
}
