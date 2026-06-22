import type { Clip } from "../clip.js";

export const RULER_HEIGHT = 24;
export const DEFAULT_TRACK_HEIGHT = 50;
export const TRIM_HANDLE_WIDTH = 4;

export interface TimelineGeometry {
  pixelsPerFrame: number;
  scrollX: number;
  headerWidth: number;
  rulerHeight: number;
  trackHeights: number[];
  /** Precomputed cumulative Y top for each track (first track top = rulerHeight). */
  cumulativeY: number[];
}

export interface TimelineGeometryOpts {
  pixelsPerFrame: number;
  scrollX?: number;
  headerWidth?: number;
  trackHeights?: number[];
}

export function makeGeometry(opts: TimelineGeometryOpts): TimelineGeometry {
  const pixelsPerFrame = opts.pixelsPerFrame;
  const scrollX = opts.scrollX ?? 0;
  const headerWidth = opts.headerWidth ?? 0;
  const trackHeights = opts.trackHeights ?? [];

  const cumulativeY: number[] = [];
  let y = RULER_HEIGHT;
  for (const h of trackHeights) {
    cumulativeY.push(y);
    y += h;
  }

  return { pixelsPerFrame, scrollX, headerWidth, rulerHeight: RULER_HEIGHT, trackHeights, cumulativeY };
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
