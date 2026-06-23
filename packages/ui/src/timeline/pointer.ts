import {
  RULER_HEIGHT,
  TRIM_HANDLE_WIDTH,
  clipRect,
  trackAtY,
} from "@palmier/core";
import type { TimelineGeometry } from "@palmier/core";
import type { EditorState } from "@palmier/core";

export type HitResult =
  | { kind: "ruler" }
  | { kind: "clip"; clipId: string; trackIndex: number; edge: "left" | "right" | null }
  | { kind: "empty" };

/** Pure hit-test: maps canvas-local CSS-px (x, y) to a timeline element. */
export function hitTest(state: EditorState, geom: TimelineGeometry, x: number, y: number): HitResult {
  if (y < RULER_HEIGHT) return { kind: "ruler" };

  const { tracks } = state.timeline;
  const ti = trackAtY(geom, y);
  const track = tracks[ti];
  if (!track) return { kind: "empty" };

  for (const clip of track.clips) {
    const rect = clipRect(geom, clip, ti);
    if (
      x >= rect.x &&
      x <= rect.x + rect.width &&
      y >= rect.y &&
      y <= rect.y + rect.height
    ) {
      let edge: "left" | "right" | null = null;
      if (x - rect.x <= TRIM_HANDLE_WIDTH) edge = "left";
      else if (rect.x + rect.width - x <= TRIM_HANDLE_WIDTH) edge = "right";
      return { kind: "clip", clipId: clip.id, trackIndex: ti, edge };
    }
  }

  return { kind: "empty" };
}
