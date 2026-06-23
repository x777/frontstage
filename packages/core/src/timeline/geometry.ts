import type { Clip } from "../clip.js";

export const RULER_HEIGHT = 24;
export const DEFAULT_TRACK_HEIGHT = 50;
export const TRIM_HANDLE_WIDTH = 4;
export const INSERT_THRESHOLD = 10;

export interface TimelineGeometry {
  pixelsPerFrame: number;
  scrollX: number;
  headerWidth: number;
  rulerHeight: number;
  dropZoneHeight: number;
  trackHeights: number[];
  /** Precomputed cumulative Y top for each track (first track top = rulerHeight + dropZoneHeight). */
  cumulativeY: number[];
}

export interface TimelineGeometryOpts {
  pixelsPerFrame: number;
  scrollX?: number;
  headerWidth?: number;
  trackHeights?: number[];
  dropZoneHeight?: number;
}

export function makeGeometry(opts: TimelineGeometryOpts): TimelineGeometry {
  const pixelsPerFrame = opts.pixelsPerFrame;
  const scrollX = opts.scrollX ?? 0;
  const headerWidth = opts.headerWidth ?? 0;
  const trackHeights = opts.trackHeights ?? [];
  const dropZoneHeight = opts.dropZoneHeight ?? 0;

  const cumulativeY: number[] = [];
  let y = RULER_HEIGHT + dropZoneHeight;
  for (const h of trackHeights) {
    cumulativeY.push(y);
    y += h;
  }

  return { pixelsPerFrame, scrollX, headerWidth, rulerHeight: RULER_HEIGHT, dropZoneHeight, trackHeights, cumulativeY };
}

export type TrackDropTarget = { kind: "existing"; index: number } | { kind: "new"; index: number };

/** Port of TimelineGeometry.dropTargetAt from Swift. */
export function dropTargetAt(g: TimelineGeometry, y: number): TrackDropTarget {
  const trackCount = g.trackHeights.length;
  if (trackCount === 0) return { kind: "new", index: 0 };

  // Top drop zone — above first track
  if (y < g.cumulativeY[0]!) return { kind: "new", index: 0 };

  // Check between-track boundaries
  for (let i = 0; i < trackCount - 1; i++) {
    const bottomOfTrack = g.cumulativeY[i]! + g.trackHeights[i]!;
    const topOfNext = g.cumulativeY[i + 1]!;
    if (y >= bottomOfTrack - INSERT_THRESHOLD && y <= topOfNext + INSERT_THRESHOLD) {
      return { kind: "new", index: i + 1 };
    }
  }

  // Bottom drop zone: past the last track
  const lastTrackBottom = g.cumulativeY[trackCount - 1]! + g.trackHeights[trackCount - 1]!;
  if (y >= lastTrackBottom) return { kind: "new", index: trackCount };

  // On an existing track
  for (let i = 0; i < g.cumulativeY.length; i++) {
    if (y < g.cumulativeY[i]! + g.trackHeights[i]!) return { kind: "existing", index: i };
  }
  return { kind: "existing", index: Math.max(0, trackCount - 1) };
}

/** Y pixel of the insertion line for a new-track drop target. Returns null for existing targets. */
export function insertionLineY(g: TimelineGeometry, target: TrackDropTarget): number | null {
  if (target.kind === "existing") return null;
  const trackCount = g.trackHeights.length;
  if (trackCount === 0) return g.rulerHeight + g.dropZoneHeight;
  if (target.index === 0) return g.cumulativeY[0]!;
  if (target.index >= trackCount) return g.cumulativeY[trackCount - 1]! + g.trackHeights[trackCount - 1]!;
  return g.cumulativeY[target.index]!;
}

/** Y pixel where a ghost clip should render for a new-track drop. Returns null for existing targets. */
export function ghostY(g: TimelineGeometry, target: TrackDropTarget, height: number = DEFAULT_TRACK_HEIGHT): number | null {
  if (target.kind !== "new") return null;
  const lineY = insertionLineY(g, target);
  if (lineY === null) return null;
  return target.index < g.trackHeights.length ? lineY - height : lineY;
}

/** frame → screen-pixel x (includes scrollX/headerWidth). */
export function xForFrame(g: TimelineGeometry, frame: number): number {
  return g.headerWidth + frame * g.pixelsPerFrame - g.scrollX;
}

/** screen-pixel x → frame. */
export function frameAtX(g: TimelineGeometry, x: number): number {
  return Math.max(0, Math.round((x - g.headerWidth + g.scrollX) / g.pixelsPerFrame));
}

export function trackTopY(g: TimelineGeometry, i: number): number {
  return g.cumulativeY[i] ?? g.rulerHeight;
}

export function trackHeightAt(g: TimelineGeometry, i: number): number {
  return g.trackHeights[i] ?? DEFAULT_TRACK_HEIGHT;
}

export function trackAtY(g: TimelineGeometry, y: number): number {
  for (let i = 0; i < g.cumulativeY.length; i++) {
    if (y < g.cumulativeY[i]! + g.trackHeights[i]!) return i;
  }
  return Math.max(0, g.trackHeights.length - 1);
}

/** Returns screen-pixel rect. */
export function clipRect(
  g: TimelineGeometry,
  clip: Clip,
  trackIndex: number
): { x: number; y: number; width: number; height: number } {
  const trackTop = trackTopY(g, trackIndex);
  const trackH = trackHeightAt(g, trackIndex);
  return {
    x: xForFrame(g, clip.startFrame),
    y: trackTop + 2,
    width: clip.durationFrames * g.pixelsPerFrame,
    height: trackH - 4,
  };
}
