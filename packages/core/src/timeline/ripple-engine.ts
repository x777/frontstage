import type { Clip } from "../clip.js";
import { clipEndFrame } from "../clip.js";
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
