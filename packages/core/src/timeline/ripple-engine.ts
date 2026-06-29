import type { Clip } from "../clip.js";
import { clipEndFrame } from "../clip.js";
import type { Timeline } from "../timeline.js";
import type { FrameRange, ClipShift } from "./ripple-types.js";
import { rangeLength } from "./ripple-types.js";

export function mergeRanges(ranges: FrameRange[]): FrameRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: FrameRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, range.end) };
    } else {
      merged.push({ start: range.start, end: range.end });
    }
  }
  return merged;
}

export function computeRippleShiftsForRanges(clips: Clip[], removedRanges: FrameRange[]): ClipShift[] {
  const merged = mergeRanges(removedRanges);
  if (merged.length === 0) return [];
  const shifts: ClipShift[] = [];
  for (const c of [...clips].sort((a, b) => a.startFrame - b.startFrame)) {
    const shift = merged
      .filter((r) => r.end <= c.startFrame)
      .reduce((sum, r) => sum + rangeLength(r), 0);
    if (shift > 0) shifts.push({ clipId: c.id, newStartFrame: c.startFrame - shift });
  }
  return shifts;
}

export function computeRippleShifts(clips: Clip[], removedIds: ReadonlySet<string>): ClipShift[] {
  const removedRanges = clips
    .filter((c) => removedIds.has(c.id))
    .map((c) => ({ start: c.startFrame, end: clipEndFrame(c) }));
  return computeRippleShiftsForRanges(
    clips.filter((c) => !removedIds.has(c.id)),
    removedRanges,
  );
}

export function computeRipplePush(
  clips: Clip[],
  insertFrame: number,
  pushAmount: number,
  excludeIds: ReadonlySet<string> = new Set(),
): ClipShift[] {
  return clips
    .filter((c) => !excludeIds.has(c.id) && c.startFrame >= insertFrame)
    .map((c) => ({ clipId: c.id, newStartFrame: c.startFrame + pushAmount }));
}

// Refuse a ripple if applying `shifts` to `trackClips` would push a clip before 0 or overlap another.
export function validateShifts(trackClips: Clip[], shifts: ClipShift[]): string | null {
  const shiftById = new Map(shifts.map((s) => [s.clipId, s.newStartFrame]));
  const projected = trackClips
    .map((c) => {
      const start = shiftById.get(c.id) ?? c.startFrame;
      return { id: c.id, start, end: start + c.durationFrames };
    })
    .sort((a, b) => a.start - b.start);
  for (const p of projected) {
    if (p.start < 0) return `clip ${p.id} would start before frame 0`;
  }
  for (let i = 1; i < projected.length; i++) {
    if (projected[i]!.start < projected[i - 1]!.end) {
      return `clips ${projected[i - 1]!.id} and ${projected[i]!.id} would overlap`;
    }
  }
  return null;
}

export function applyShifts(timeline: Timeline, shifts: ClipShift[]): Timeline {
  if (shifts.length === 0) return timeline;
  const shiftById = new Map(shifts.map((s) => [s.clipId, s.newStartFrame]));
  const tracks = timeline.tracks.map((t) => {
    let changed = false;
    const clips = t.clips.map((c) => {
      const ns = shiftById.get(c.id);
      if (ns === undefined || ns === c.startFrame) return c;
      changed = true;
      return { ...c, startFrame: ns };
    });
    if (!changed) return t;
    clips.sort((a, b) => a.startFrame - b.startFrame);
    return { ...t, clips };
  });
  return { ...timeline, tracks };
}
