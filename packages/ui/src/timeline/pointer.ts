import {
  RULER_HEIGHT,
  TRIM_HANDLE_WIDTH,
  clipRect,
  trackAtY,
  trimClipCommand,
  rippleTrimClipCommand,
} from "@frontstage/core";
import type { TimelineGeometry, Command, SelectForwardScope } from "@frontstage/core";
import type { EditorState } from "@frontstage/core";

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

/**
 * Picks the plain-overwrite or shift-drag-ripple trim command for one pointermove tick.
 *
 * The store applies commands against its live (already-mutated) timeline, so a delta must be
 * "how much more since the last tick," not absolute-from-drag-start (that convention only works
 * for absolute-position commands like moveClipCommand). `absoluteDeltaFromDragStart` is what the
 * existing trim geometry helpers (trimLeftDelta/trimRightDelta) return; for the ripple path this
 * re-derives the increment from `priorAbsoluteDelta` — the value returned by the previous call —
 * before dispatching, and plain trim is untouched (it already takes the absolute delta directly).
 */
export function trimTickCommand(
  clipId: string,
  edge: "left" | "right",
  absoluteDeltaFromDragStart: number,
  isRipple: boolean,
  priorAbsoluteDelta: number,
  coalesceKey: string,
): Command {
  if (!isRipple) return trimClipCommand(clipId, edge, absoluteDeltaFromDragStart, coalesceKey);
  const incremental = absoluteDeltaFromDragStart - priorAbsoluteDelta;
  return rippleTrimClipCommand(clipId, edge, incremental, true, coalesceKey);
}

/** "A" selects forward on the anchor track; Shift+A extends the scope to every track. Any other
 * modifier (Cmd/Ctrl/Opt) or key means "not this shortcut" — null. */
export function selectForwardScopeForKey(e: {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}): SelectForwardScope | null {
  if (e.key.toLowerCase() !== "a" || e.metaKey || e.ctrlKey || e.altKey) return null;
  return e.shiftKey ? "allTracks" : "track";
}
