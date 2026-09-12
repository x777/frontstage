import type { Clip } from "../clip.js";
import { TRIM_HANDLE_WIDTH } from "./geometry.js";

/** Palmier `ClipRenderer.volumeKeyframeSize`. */
export const FADE_HANDLE_SIZE = 7;
/** Palmier `ClipRenderer.volumeKeyframeHitSize`. */
export const FADE_HANDLE_HIT_SIZE = 14;
/** Palmier `ClipRenderer.fadeKneeTopInset`. */
export const FADE_KNEE_TOP_INSET = 4;
/** Palmier `ClipRenderer.labelBarHeight`. */
export const CLIP_LABEL_BAR_HEIGHT = 16;
/**
 * Palmier `volumeFadeHandleEdgeInset` = trim handle + hit/2 + xxs.
 * Keeps fade knees off the trim strips.
 */
export const FADE_HANDLE_EDGE_INSET = TRIM_HANDLE_WIDTH + FADE_HANDLE_HIT_SIZE / 2 + 2;

export type FadeEdge = "left" | "right";

export function fadeHandleRenderX(
  clipX: number,
  clipWidth: number,
  kfOffset: number,
  pxPerFrame: number,
): number {
  const actual = clipX + kfOffset * pxPerFrame;
  const edgeInset = Math.min(FADE_HANDLE_EDGE_INSET, Math.max(0, clipWidth / 2));
  return Math.min(clipX + clipWidth - edgeInset, Math.max(clipX + edgeInset, actual));
}

export function fadeKneeCenter(
  clip: Clip,
  edge: FadeEdge,
  clipRect: { x: number; y: number; width: number; height: number },
): { x: number; y: number } {
  const pxPerFrame = clip.durationFrames > 0 ? clipRect.width / clip.durationFrames : 0;
  const leftOffset = Math.min(clip.fadeInFrames, clip.durationFrames);
  const rightOffset = Math.max(0, clip.durationFrames - clip.fadeOutFrames);
  const kfOffset = edge === "left" ? leftOffset : rightOffset;
  const x = fadeHandleRenderX(clipRect.x, clipRect.width, kfOffset, pxPerFrame);
  const bodyY = clipRect.y + CLIP_LABEL_BAR_HEIGHT;
  const y = bodyY + FADE_KNEE_TOP_INSET;
  return { x, y };
}

export function fadeKneeHitRect(
  clip: Clip,
  edge: FadeEdge,
  clipRect: { x: number; y: number; width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const c = fadeKneeCenter(clip, edge, clipRect);
  const half = FADE_HANDLE_HIT_SIZE / 2;
  return { x: c.x - half, y: c.y - half, width: FADE_HANDLE_HIT_SIZE, height: FADE_HANDLE_HIT_SIZE };
}

export function pointInRect(
  x: number,
  y: number,
  r: { x: number; y: number; width: number; height: number },
): boolean {
  return x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height;
}

/** Palmier `applyFadeKneeDrag` — fade length from a timeline-frame cursor. */
export function fadeFramesFromCursor(
  clip: Pick<Clip, "startFrame" | "durationFrames" | "fadeInFrames" | "fadeOutFrames">,
  edge: FadeEdge,
  cursorFrame: number,
): number {
  const proposed =
    edge === "left" ? cursorFrame - clip.startFrame : clip.startFrame + clip.durationFrames - cursorFrame;
  const counter = edge === "left" ? clip.fadeOutFrames : clip.fadeInFrames;
  const cap = Math.max(0, clip.durationFrames - counter);
  return Math.max(0, Math.min(cap, Math.round(proposed)));
}

export function fadeKneeHit(
  clip: Clip,
  clipRect: { x: number; y: number; width: number; height: number },
  x: number,
  y: number,
): FadeEdge | null {
  if (pointInRect(x, y, fadeKneeHitRect(clip, "left", clipRect))) return "left";
  if (pointInRect(x, y, fadeKneeHitRect(clip, "right", clipRect))) return "right";
  return null;
}
