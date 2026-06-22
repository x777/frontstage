import type { SnapResult } from "./snap.js";

function clamp(value: number, min: number, max: number): number {
  const r = Math.max(min, Math.min(max, value));
  return r === 0 ? 0 : r;
}

/** All arguments and returned delta in frame units. */
export function moveDelta(args: {
  cursorFrame: number;
  grabOffsetFrames: number;
  originalFrame: number;
  minOriginalFrame: number;
  snap: SnapResult | null;
}): number {
  const { cursorFrame, grabOffsetFrames, originalFrame, minOriginalFrame, snap } = args;
  const candidate = cursorFrame - grabOffsetFrames;
  let delta: number;
  if (snap !== null) {
    delta = snap.frame - snap.probeOffset - originalFrame;
  } else {
    delta = candidate - originalFrame;
  }
  return Math.max(-minOriginalFrame, delta);
}

/** All arguments and returned delta in frame units. */
export function trimLeftDelta(args: {
  snappedStartFrame: number;
  originalStartFrame: number;
  originalDuration: number;
  originalTrimStart: number;
  hasNoSourceMedia: boolean;
}): number {
  const { snappedStartFrame, originalStartFrame, originalDuration, originalTrimStart, hasNoSourceMedia } = args;
  const delta = snappedStartFrame - originalStartFrame;
  const maxDelta = originalDuration - 1;
  const minDelta = hasNoSourceMedia ? -originalStartFrame : -originalTrimStart;
  return clamp(delta, minDelta, maxDelta);
}

/** All arguments and returned delta in frame units. */
export function trimRightDelta(args: {
  snappedEndFrame: number;
  originalStartFrame: number;
  originalDuration: number;
  originalTrimEnd: number;
  hasNoSourceMedia: boolean;
}): number {
  const { snappedEndFrame, originalStartFrame, originalDuration, originalTrimEnd, hasNoSourceMedia } = args;
  const originalEnd = originalStartFrame + originalDuration;
  const delta = snappedEndFrame - originalEnd;
  const minDelta = -(originalDuration - 1);
  const maxDelta = hasNoSourceMedia ? Infinity : originalTrimEnd;
  return clamp(delta, minDelta, maxDelta);
}
