import type { Clip } from "../clip.js";
import type { MediaManifestEntry } from "../media.js";
import type { Timeline, Track } from "../timeline.js";
import { findClip } from "../timeline.js";
import type { ClipShift, FrameRange, GapSelection } from "../timeline/ripple-types.js";
import { validateShifts, computeRippleShifts, computeRippleShiftsForRanges, applyShifts, mergeRanges, computeRipplePush } from "../timeline/ripple-engine.js";
import { computeOverwrite, applyOverwriteToClips } from "../timeline/overwrite.js";
import { replaceTrackClips, clipFromAsset, splitClipCommand, addClipCommand } from "./timeline-commands.js";
import { linkedPartnerIds } from "../timeline/link-group.js";
import { setDuration } from "../clip-mutations.js";

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

  // Sync-locked followers get the range cut out too, not just shifted — avoids refusing on collisions
  // that clearing itself would have resolved.
  for (const t of timeline.tracks) {
    if (t.syncLocked && !ignoredIds.has(t.id)) clearTrackIds.add(t.id);
  }

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

export function rippleDeleteGap(timeline: Timeline, gap: GapSelection): RippleGapOutcome {
  const gapTrack = timeline.tracks[gap.trackIndex];
  if (!gapTrack || gap.range.end - gap.range.start <= 0) return { timeline };

  const filled = gapTrack.clips.some((c) => c.startFrame < gap.range.end && c.startFrame + c.durationFrames > gap.range.start);
  if (filled) return { stale: true };

  const shifts: ClipShift[] = [];
  for (let ti = 0; ti < timeline.tracks.length; ti++) {
    const t = timeline.tracks[ti]!;
    if (ti === gap.trackIndex) {
      shifts.push(...computeRippleShiftsForRanges(t.clips, [gap.range]));
    } else if (t.syncLocked) {
      const s = computeRippleShiftsForRanges(t.clips, [gap.range]);
      const err = validateShiftsForTrack(t, s);
      if (err) return { refused: err };
      shifts.push(...s);
    }
  }
  return { timeline: applyShifts(timeline, shifts) };
}

export function trimValues(clip: Clip, edge: "left" | "right", delta: number): { trimStart: number; trimEnd: number } {
  const sourceDelta = Math.round(delta * clip.speed);
  const unbounded = clip.mediaType === "image" || clip.mediaType === "text";
  if (edge === "left") {
    const newStart = clip.trimStartFrame + sourceDelta;
    return { trimStart: unbounded ? newStart : Math.max(0, newStart), trimEnd: clip.trimEndFrame };
  }
  const newEnd = clip.trimEndFrame - sourceDelta;
  return { trimStart: clip.trimStartFrame, trimEnd: unbounded ? newEnd : Math.max(0, newEnd) };
}

export function rippleTrimDurationDelta(clip: Clip, edge: "left" | "right", delta: number): number {
  const f = trimValues(clip, edge, delta);
  const sourceShift = (f.trimStart - clip.trimStartFrame) + (f.trimEnd - clip.trimEndFrame);
  return -Math.round(sourceShift / clip.speed);
}

export function syncLockedLeftRoom(track: Track, insertFrame: number): { room: number; obstacle: number } | null {
  const after = track.clips.filter((c) => c.startFrame >= insertFrame).map((c) => c.startFrame);
  if (after.length === 0) return null;
  const first = Math.min(...after);
  const before = track.clips.filter((c) => c.startFrame < insertFrame).map((c) => c.startFrame + c.durationFrames);
  const prevEnd = before.length ? Math.max(...before) : 0;
  return { room: Math.max(0, first - prevEnd), obstacle: prevEnd };
}

export interface RippleTrimResize { clipId: string; trimStart: number; trimEnd: number; duration: number }
export interface RippleTrimPlan { durationDelta: number; resizes: RippleTrimResize[]; shifts: ClipShift[]; blockedAtFrame: number | null }

export function planRippleTrim(
  timeline: Timeline,
  clipId: string,
  edge: "left" | "right",
  deltaFrames: number,
  propagateToLinked: boolean,
): RippleTrimPlan | null {
  if (deltaFrames === 0) return null;
  const leadLoc = findClip(timeline, clipId);
  if (!leadLoc) return null;
  const leadClip = timeline.tracks[leadLoc.trackIndex]!.clips[leadLoc.clipIndex]!;
  const leadEnd = leadClip.startFrame + leadClip.durationFrames;

  const targets = [clipId, ...(propagateToLinked ? linkedPartnerIds(timeline, clipId) : [])];
  const targetIds = new Set(targets);
  const targetClips: Clip[] = [];
  for (const id of targets) {
    const loc = findClip(timeline, id);
    if (loc) targetClips.push(timeline.tracks[loc.trackIndex]!.clips[loc.clipIndex]!);
  }

  const deltas = targetClips.map((c) => rippleTrimDurationDelta(c, edge, deltaFrames));
  const sourceDelta = deltas.length === 0 ? 0 : deltas.reduce((m, d) => (Math.abs(d) < Math.abs(m) ? d : m));

  let durationDelta = sourceDelta;
  let blockedAtFrame: number | null = null;
  if (sourceDelta < 0) {
    const limits: { room: number; obstacle: number }[] = [];
    for (const track of timeline.tracks) {
      if (!track.syncLocked || track.clips.some((c) => targetIds.has(c.id))) continue;
      const r = syncLockedLeftRoom(track, leadEnd);
      if (r) limits.push(r);
    }
    if (limits.length) {
      const tightest = limits.reduce((a, b) => (b.room < a.room ? b : a));
      if (sourceDelta < -tightest.room) {
        durationDelta = -tightest.room;
        blockedAtFrame = tightest.obstacle;
      }
    }
  }
  if (durationDelta === 0 && blockedAtFrame === null) return null;

  const resizes: RippleTrimResize[] = targetClips.map((c) => {
    const f = trimValues(c, edge, edge === "right" ? durationDelta : -durationDelta);
    return { clipId: c.id, trimStart: f.trimStart, trimEnd: f.trimEnd, duration: Math.max(1, c.durationFrames + durationDelta) };
  });

  const shifts: ClipShift[] = [];
  for (const track of timeline.tracks) {
    const targetClip = track.clips.find((c) => targetIds.has(c.id));
    const targetEnd = targetClip ? targetClip.startFrame + targetClip.durationFrames : null;
    if (targetEnd === null && !track.syncLocked) continue;
    shifts.push(...computeRipplePush(track.clips, targetEnd ?? leadEnd, durationDelta, targetIds));
  }
  return { durationDelta, resizes, shifts, blockedAtFrame };
}

export function applyRippleTrim(timeline: Timeline, plan: RippleTrimPlan): Timeline {
  const byId = new Map(plan.resizes.map((r) => [r.clipId, r]));
  const resized: Timeline = {
    ...timeline,
    tracks: timeline.tracks.map((t) => ({
      ...t,
      clips: t.clips.map((c) => {
        const r = byId.get(c.id);
        return r ? setDuration({ ...c, trimStartFrame: r.trimStart, trimEndFrame: r.trimEnd }, r.duration) : c;
      }),
    })),
  };
  return applyShifts(resized, plan.shifts);
}

export function rippleTrimClip(
  timeline: Timeline,
  clipId: string,
  edge: "left" | "right",
  deltaFrames: number,
  propagateToLinked: boolean,
): Timeline {
  const plan = planRippleTrim(timeline, clipId, edge, deltaFrames, propagateToLinked);
  return plan ? applyRippleTrim(timeline, plan) : timeline;
}

function entryDurationFrames(entry: MediaManifestEntry, fps: number): number {
  return Math.max(1, Math.round(entry.duration * fps));
}

export function rippleInsertClips(
  timeline: Timeline,
  entries: MediaManifestEntry[],
  trackIndex: number,
  atFrame: number,
  fps: number,
  newId: () => string = () => crypto.randomUUID(),
): { timeline: Timeline } {
  if (trackIndex < 0 || trackIndex >= timeline.tracks.length || entries.length === 0) return { timeline };
  const totalPush = entries.reduce((s, e) => s + entryDurationFrames(e, fps), 0);

  const shifts: ClipShift[] = [];
  for (let ti = 0; ti < timeline.tracks.length; ti++) {
    const t = timeline.tracks[ti]!;
    if (ti === trackIndex || t.syncLocked) shifts.push(...computeRipplePush(t.clips, atFrame, totalPush));
  }
  let next = applyShifts(timeline, shifts);

  let cursor = atFrame;
  for (const e of entries) {
    next = addClipCommand(e, { kind: "existing", index: trackIndex }, cursor, fps, undefined, newId).apply(next);
    cursor += entryDurationFrames(e, fps);
  }
  return { timeline: next };
}

export interface RippleInsertSpec {
  entry: MediaManifestEntry;
  durationFrames: number;
  trimStartFrame?: number;
  trimEndFrame?: number;
}

// Overwrite-place a single clip on a track (clears its [start,end) region first).
function overwritePlaceClip(timeline: Timeline, trackIndex: number, clip: Clip): Timeline {
  const track = timeline.tracks[trackIndex]!;
  const end = clip.startFrame + clip.durationFrames;
  const cleared = applyOverwriteToClips(track.clips, computeOverwrite(track.clips, clip.startFrame, end));
  return replaceTrackClips(timeline, trackIndex, [...cleared, clip].sort((a, b) => a.startFrame - b.startFrame));
}

function placeSpec(
  timeline: Timeline,
  spec: RippleInsertSpec,
  trackIndex: number,
  startFrame: number,
  linkedAudioTrackIndex: number | null,
  fps: number,
  newId: () => string,
): Timeline {
  const shouldLink = linkedAudioTrackIndex != null && spec.entry.type === "video" && spec.entry.hasAudio === true;
  const linkGroupId = shouldLink ? newId() : undefined;
  const visual: Clip = {
    ...clipFromAsset(spec.entry, fps, startFrame, newId),
    durationFrames: spec.durationFrames,
    trimStartFrame: spec.trimStartFrame ?? 0,
    trimEndFrame: spec.trimEndFrame ?? 0,
    linkGroupId,
  };
  let next = overwritePlaceClip(timeline, trackIndex, visual);
  if (linkGroupId != null && linkedAudioTrackIndex != null) {
    const audio: Clip = {
      ...clipFromAsset(spec.entry, fps, startFrame, newId),
      mediaType: "audio",
      sourceClipType: spec.entry.type,
      durationFrames: spec.durationFrames,
      trimStartFrame: spec.trimStartFrame ?? 0,
      trimEndFrame: spec.trimEndFrame ?? 0,
      linkGroupId,
    };
    next = overwritePlaceClip(next, linkedAudioTrackIndex, audio);
  }
  return next;
}

export function rippleInsertClipsSpecs(
  timeline: Timeline,
  specs: RippleInsertSpec[],
  trackIndex: number,
  atFrame: number,
  fps: number,
  newId: () => string = () => crypto.randomUUID(),
): { timeline: Timeline } {
  if (trackIndex < 0 || trackIndex >= timeline.tracks.length || specs.length === 0) return { timeline };
  const totalPush = specs.reduce((s, sp) => s + sp.durationFrames, 0);

  let next = timeline;
  // Pin the linked-audio destination before pushing so it ripples too.
  const targetIsVideo = next.tracks[trackIndex]!.type === "video";
  const needsLinkedAudio = targetIsVideo && specs.some((sp) => sp.entry.type === "video" && sp.entry.hasAudio === true);
  let linkedAudioTrackIndex: number | null = null;
  if (needsLinkedAudio) {
    const existing = next.tracks.findIndex((t) => t.type === "audio");
    if (existing !== -1) {
      linkedAudioTrackIndex = existing;
    } else {
      const audioTrack: Track = { id: newId(), type: "audio", muted: false, hidden: false, syncLocked: false, clips: [] };
      next = { ...next, tracks: [...next.tracks, audioTrack] };
      linkedAudioTrackIndex = next.tracks.length - 1;
    }
  }

  const pushTracksSet = new Set<number>();
  for (let ti = 0; ti < next.tracks.length; ti++) {
    if (ti === trackIndex || ti === linkedAudioTrackIndex || next.tracks[ti]!.syncLocked) pushTracksSet.add(ti);
  }
  const pushTracks = [...pushTracksSet];

  // Split any clip straddling atFrame on each push-track so its right half rides the ripple.
  for (const ti of pushTracks) {
    const straddler = next.tracks[ti]!.clips.find((c) => c.startFrame < atFrame && atFrame < c.startFrame + c.durationFrames);
    if (straddler) next = splitClipCommand(straddler.id, atFrame, undefined, newId).apply(next);
  }

  const shifts: ClipShift[] = [];
  for (const ti of pushTracks) shifts.push(...computeRipplePush(next.tracks[ti]!.clips, atFrame, totalPush));
  next = applyShifts(next, shifts);

  let cursor = atFrame;
  for (const sp of specs) {
    next = placeSpec(next, sp, trackIndex, cursor, linkedAudioTrackIndex, fps, newId);
    cursor += sp.durationFrames;
  }
  return { timeline: next };
}
