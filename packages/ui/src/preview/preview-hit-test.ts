import { buildRenderPlan, topClipAtPoint, expandToLinkGroup } from "@frontstage/core";
import type { EditorStore, Size } from "@frontstage/core";

/**
 * Double-click on the preview canvas -> select the topmost clip under the point at the current
 * frame. Pure w.r.t. the DOM: takes the click's viewport point and the canvas's displayed rect
 * (from `getBoundingClientRect()`) so it's testable without mounting a real canvas/engine.
 *
 * The canvas's intrinsic size equals the composition resolution (timeline.width/height) — CSS
 * `objectFit: contain` only scales the DISPLAY, so scaling by displayedRect recovers
 * composition-pixel coordinates directly (no separate aspect-fit/letterbox math needed).
 */
export function selectClipAtPreviewPoint(
  store: EditorStore,
  sourceSizes: Map<string, Size>,
  clientPoint: { x: number; y: number },
  displayedRect: { left: number; top: number; width: number; height: number },
): void {
  if (displayedRect.width <= 0 || displayedRect.height <= 0) return;
  const snap = store.getSnapshot();
  const renderSize: Size = { width: snap.timeline.width, height: snap.timeline.height };
  const point = {
    x: (clientPoint.x - displayedRect.left) * (renderSize.width / displayedRect.width),
    y: (clientPoint.y - displayedRect.top) * (renderSize.height / displayedRect.height),
  };
  const plan = buildRenderPlan(snap.timeline, snap.playhead, sourceSizes);
  const clipId = topClipAtPoint(plan, renderSize, point);
  if (clipId) store.select(expandToLinkGroup(snap.timeline, new Set([clipId])));
}
