import type { Timeline, Track } from "../timeline.js";
import type { ClipShift } from "../timeline/ripple-types.js";
import type { FrameRange } from "../timeline/ripple-types.js";
import { validateShifts } from "../timeline/ripple-engine.js";
import { computeRippleShifts, computeRippleShiftsForRanges, applyShifts } from "../timeline/ripple-engine.js";
import { computeOverwrite, applyOverwriteToClips } from "../timeline/overwrite.js";
import { replaceTrackClips } from "./timeline-commands.js";
import { mergeRanges } from "../timeline/ripple-engine.js";
import { linkedPartnerIds } from "../timeline/link-group.js";
import { findClip } from "../timeline.js";

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

export function rippleDeleteRangesOnTrack(
  timeline: Timeline,
  trackIndex: number,
  ranges: FrameRange[],
  ignoreSyncLockTrackIndices: ReadonlySet<number> = new Set(),
): RippleRangesOutcome {
  const anchor = timeline.tracks[trackIndex];
  if (!anchor) return { kind: "refused", reason: `track index ${trackIndex} out of range` };

  const merged = mergeRanges(ranges.filter((r) => r.end - r.start > 0));
  const emptyReport = (): RippleRangesReport => ({
    removedFrames: 0, clearedTracks: 0, shiftedClips: 0, anchorTrackIndex: trackIndex,
    resultingFragments: anchor.clips.map((c) => ({ clipId: c.id, startFrame: c.startFrame, durationFrames: c.durationFrames })),
    removedClipIds: [],
  });
  if (merged.length === 0) return { kind: "ok", timeline, report: emptyReport() };

  const totalRemoved = merged.reduce((s, r) => s + (r.end - r.start), 0);

  // clearTrackIds: the anchor + tracks holding linked partners of any anchor clip overlapping the ranges.
  const clearTrackIds = new Set<string>([anchor.id]);
  for (const c of anchor.clips) {
    const overlaps = merged.some((r) => r.start < c.startFrame + c.durationFrames && r.end > c.startFrame);
    if (c.linkGroupId != null && overlaps) {
      for (const pid of linkedPartnerIds(timeline, c.id)) {
        const loc = findClip(timeline, pid);
        if (loc) clearTrackIds.add(timeline.tracks[loc.trackIndex]!.id);
      }
    }
  }

  const ignoredIds = new Set(
    [...ignoreSyncLockTrackIndices].map((i) => timeline.tracks[i]?.id).filter((id): id is string => id != null),
  );

  // Pre-flight: any non-ignored, non-clear, sync-locked track that would collide refuses the whole op.
  for (const t of timeline.tracks) {
    if (clearTrackIds.has(t.id) || !t.syncLocked || ignoredIds.has(t.id)) continue;
    const s = computeRippleShiftsForRanges(t.clips, merged);
    const err = validateShiftsForTrack(t, s);
    if (err) return { kind: "refused", reason: err };
  }

  const anchorBeforeIds = new Set(anchor.clips.map((c) => c.id));

  // 1) clear the merged ranges on every clear-track.
  let next = timeline;
  for (const tid of clearTrackIds) {
    const ti = next.tracks.findIndex((t) => t.id === tid);
    if (ti === -1) continue;
    for (const r of merged) next = clearRegion(next, ti, r.start, r.end);
  }

  // 2) shift the clear-tracks + every non-ignored sync-locked follower to close the gaps.
  const shifts: ClipShift[] = [];
  for (const t of next.tracks) {
    const isClear = clearTrackIds.has(t.id);
    const isFollower = t.syncLocked && !ignoredIds.has(t.id) && !isClear;
    if (!isClear && !isFollower) continue;
    shifts.push(...computeRippleShiftsForRanges(t.clips, merged));
  }
  next = applyShifts(next, shifts);

  const anchorAfter = next.tracks.find((t) => t.id === anchor.id)!;
  const removedClipIds = [...anchorBeforeIds].filter((id) => !anchorAfter.clips.some((c) => c.id === id));
  const report: RippleRangesReport = {
    removedFrames: totalRemoved,
    clearedTracks: clearTrackIds.size,
    shiftedClips: shifts.length,
    anchorTrackIndex: trackIndex,
    resultingFragments: anchorAfter.clips
      .map((c) => ({ clipId: c.id, startFrame: c.startFrame, durationFrames: c.durationFrames }))
      .sort((a, b) => a.startFrame - b.startFrame),
    removedClipIds,
  };
  return { kind: "ok", timeline: next, report };
}

export function rippleDeleteRanges(timeline: Timeline, anchorClipId: string, ranges: FrameRange[]): RippleRangesOutcome {
  const loc = findClip(timeline, anchorClipId);
  if (!loc) return { kind: "refused", reason: `unknown clip: ${anchorClipId}` };
  return rippleDeleteRangesOnTrack(timeline, loc.trackIndex, ranges);
}
