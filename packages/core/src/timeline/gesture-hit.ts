import type { Timeline } from "../timeline.js";
import { type TimelineGeometry, clipRect, xForFrame } from "./geometry.js";
import { expandToLinkGroup } from "./link-group.js";
import type { TimelineRangeSelection } from "./ripple-types.js";

export interface Rect { x: number; y: number; width: number; height: number }

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function marqueeSelect(
  timeline: Timeline,
  geometry: TimelineGeometry,
  rect: Rect,
  baseSelection: ReadonlySet<string>,
  expandLinks: boolean,
): Set<string> {
  const selected = new Set(baseSelection);
  for (let ti = 0; ti < timeline.tracks.length; ti++) {
    for (const clip of timeline.tracks[ti]!.clips) {
      if (rectsIntersect(clipRect(geometry, clip, ti), rect)) selected.add(clip.id);
    }
  }
  return expandLinks ? expandToLinkGroup(timeline, selected) : selected;
}

export const RANGE_EDGE_SLOP = 8;
export type RangeEdge = "start" | "end";

export function timelineRangeEdgeHit(
  geometry: TimelineGeometry,
  x: number,
  range: TimelineRangeSelection,
  slop: number = RANGE_EDGE_SLOP,
): RangeEdge | null {
  const startX = xForFrame(geometry, range.startFrame);
  const endX = xForFrame(geometry, range.endFrame);
  const startDistance = Math.abs(x - startX);
  const endDistance = Math.abs(x - endX);
  if (Math.min(startDistance, endDistance) > slop) return null;
  return startDistance <= endDistance ? "start" : "end";
}

export function rangeEdgeAnchorFrame(range: TimelineRangeSelection, edge: RangeEdge): number {
  return edge === "start" ? range.endFrame : range.startFrame;
}
