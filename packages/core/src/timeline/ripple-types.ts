// Half-open [start, end) frame interval on one track. Mirrors Swift FrameRange.
export interface FrameRange {
  start: number;
  end: number;
}

export function rangeLength(r: FrameRange): number {
  return r.end - r.start;
}

// A proposed new start frame for a single clip, produced by the ripple engine.
export interface ClipShift {
  clipId: string;
  newStartFrame: number;
}

// A user-selected empty gap on one track.
export interface GapSelection {
  trackIndex: number;
  range: FrameRange;
}

// The ruler in/out range. May be stored inverted; consult the helpers below.
export interface TimelineRangeSelection {
  startFrame: number;
  endFrame: number;
}

export function normalizeRange(r: TimelineRangeSelection): TimelineRangeSelection {
  return r.endFrame < r.startFrame ? { startFrame: r.endFrame, endFrame: r.startFrame } : r;
}

export function isValidRange(r: TimelineRangeSelection): boolean {
  const n = normalizeRange(r);
  return n.endFrame > n.startFrame;
}

export function rangeContains(r: TimelineRangeSelection, frame: number): boolean {
  const n = normalizeRange(r);
  return frame >= n.startFrame && frame < n.endFrame;
}
