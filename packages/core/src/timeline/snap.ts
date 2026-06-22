import type { Track } from "../timeline.js";
import { clipEndFrame } from "../clip.js";

export const SNAP_BASE_PX = 8;
export const SNAP_STICKY_MULT = 1.5;
export const SNAP_PLAYHEAD_MULT = 1.5;

export type SnapKind = "playhead" | "clipEdge";

export interface SnapTarget {
  frame: number;
  kind: SnapKind;
}

export interface SnapResult {
  frame: number;
  probeOffset: number;
  x: number;
  didSnap: true;
}

export interface SnapState {
  currentlySnappedTo: number | null;
  currentProbeOffset: number;
}

export function newSnapState(): SnapState {
  return { currentlySnappedTo: null, currentProbeOffset: 0 };
}

export function collectTargets(
  tracks: Track[],
  opts: {
    playheadFrame?: number;
    excludeClipIds?: Set<string>;
    includePlayhead?: boolean;
  } = {}
): SnapTarget[] {
  const { playheadFrame = 0, excludeClipIds = new Set(), includePlayhead = false } = opts;
  const targets: SnapTarget[] = [];
  if (includePlayhead) {
    targets.push({ frame: playheadFrame, kind: "playhead" });
  }
  for (const track of tracks) {
    for (const clip of track.clips) {
      if (excludeClipIds.has(clip.id)) continue;
      targets.push({ frame: clip.startFrame, kind: "clipEdge" });
      targets.push({ frame: clipEndFrame(clip), kind: "clipEdge" });
    }
  }
  return targets;
}

/** position and probeOffsets in frame units; SnapResult.x is content-pixel units (frame * pixelsPerFrame, before scrollX/headerWidth). */
export function findSnap(args: {
  position: number;
  probeOffsets?: number[];
  targets: SnapTarget[];
  state: SnapState;
  baseThresholdPx: number;
  pixelsPerFrame: number;
}): SnapResult | null {
  const { position, probeOffsets = [0], targets, state, baseThresholdPx, pixelsPerFrame } = args;
  const baseFrameThreshold = baseThresholdPx / pixelsPerFrame;

  // Sticky: stay snapped until moved stickyMult * threshold away
  if (state.currentlySnappedTo !== null) {
    const snapped = state.currentlySnappedTo;
    const holdThreshold = baseFrameThreshold * SNAP_STICKY_MULT;
    const probePos = position + state.currentProbeOffset;
    if (Math.abs(probePos - snapped) <= holdThreshold && targets.some((t) => t.frame === snapped)) {
      return { frame: snapped, probeOffset: state.currentProbeOffset, x: snapped * pixelsPerFrame, didSnap: true };
    }
    state.currentlySnappedTo = null;
    state.currentProbeOffset = 0;
  }

  // Find closest (probe, target) pair
  let best: { probeOffset: number; target: SnapTarget; distance: number } | null = null;
  for (const probeOffset of probeOffsets) {
    const probePos = position + probeOffset;
    for (const target of targets) {
      const threshold = target.kind === "playhead" ? baseFrameThreshold * SNAP_PLAYHEAD_MULT : baseFrameThreshold;
      const dist = Math.abs(probePos - target.frame);
      if (dist <= threshold && (best === null || dist < best.distance)) {
        best = { probeOffset, target, distance: dist };
      }
    }
  }

  if (best === null) return null;

  state.currentlySnappedTo = best.target.frame;
  state.currentProbeOffset = best.probeOffset;
  return { frame: best.target.frame, probeOffset: best.probeOffset, x: best.target.frame * pixelsPerFrame, didSnap: true };
}
