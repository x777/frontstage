import type { Timeline, Track } from "../timeline.js";
import type { ClipShift } from "../timeline/ripple-types.js";
import type { FrameRange } from "../timeline/ripple-types.js";
import { validateShifts } from "../timeline/ripple-engine.js";
import { computeRippleShifts, computeRippleShiftsForRanges, applyShifts } from "../timeline/ripple-engine.js";
import { computeOverwrite, applyOverwriteToClips } from "../timeline/overwrite.js";
import { replaceTrackClips } from "./timeline-commands.js";

export type RippleOutcome = { timeline: Timeline } | { refused: string };

export interface RippleRangesReport {
  removedFrames: number;
  clearedTracks: number;
  shiftedClips: number;
  anchorTrackIndex: number;
  resultingFragments: { clipId: string; startFrame: number; durationFrames: number }[];
  removedClipIds: string[];
}

export type RippleRangesOutcome =
  | { kind: "ok"; timeline: Timeline; report: RippleRangesReport }
  | { kind: "refused"; reason: string };

export type RippleGapOutcome = { timeline: Timeline } | { refused: string } | { stale: true };

// Overwrite-clear the half-open [start, end) region on one track.
export function clearRegion(timeline: Timeline, trackIndex: number, start: number, end: number): Timeline {
  const track = timeline.tracks[trackIndex];
  if (!track) return timeline;
  const actions = computeOverwrite(track.clips, start, end);
  return replaceTrackClips(timeline, trackIndex, applyOverwriteToClips(track.clips, actions));
}

export function validateShiftsForTrack(track: Track, shifts: ClipShift[]): string | null {
  const err = validateShifts(track.clips, shifts);
  return err ? `sync-locked track "${track.id}" can't ripple: ${err}` : null;
}

export function rippleDeleteSelectedClips(timeline: Timeline, selectedIds: ReadonlySet<string>): RippleOutcome {
  if (selectedIds.size === 0) return { timeline };

  const globalRanges: FrameRange[] = [];
  for (const t of timeline.tracks) {
    for (const c of t.clips) {
      if (selectedIds.has(c.id)) globalRanges.push({ start: c.startFrame, end: c.startFrame + c.durationFrames });
    }
  }

  const shifts: ClipShift[] = [];
  for (const track of timeline.tracks) {
    if (track.clips.some((c) => selectedIds.has(c.id))) {
      shifts.push(...computeRippleShifts(track.clips, selectedIds));
    } else if (track.syncLocked) {
      const s = computeRippleShiftsForRanges(track.clips, globalRanges);
      const err = validateShiftsForTrack(track, s);
      if (err) return { refused: err };
      shifts.push(...s);
    }
  }

  const removed: Timeline = {
    ...timeline,
    tracks: timeline.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => !selectedIds.has(c.id)) })),
  };
  return { timeline: applyShifts(removed, shifts) };
}
