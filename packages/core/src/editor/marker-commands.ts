import type { TimelineMarker } from "../timeline-marker.js";
import { validateTimelineMarker } from "../timeline-marker.js";
import type { Timeline } from "../timeline.js";
import { timelineMarkers } from "../timeline.js";
import type { Command } from "./editor-store.js";

export interface TimelineMarkerChangeReceipt {
  created: TimelineMarker[];
  updated: TimelineMarker[];
  deletedIds: string[];
  timeline: Timeline;
}

function sortMarkers(markers: TimelineMarker[]): TimelineMarker[] {
  return [...markers].sort((a, b) => a.startFrame - b.startFrame || a.id.localeCompare(b.id));
}

export function changeTimelineMarkers(
  timeline: Timeline,
  opts: { creates?: TimelineMarker[]; updates?: TimelineMarker[]; deleteIds?: string[] },
): TimelineMarkerChangeReceipt {
  const deleteIds = opts.deleteIds ?? [];
  const deleteSet = new Set(deleteIds);
  if (deleteSet.size !== deleteIds.length) throw new Error("invalidRange");
  const before = timelineMarkers(timeline);
  const beforeIds = new Set(before.map((m) => m.id));
  if ([...deleteSet].some((id) => !beforeIds.has(id))) throw new Error("invalidRange");

  let next = before;
  const updated: TimelineMarker[] = [];
  for (const marker of (opts.updates ?? []).map(validateTimelineMarker)) {
    if (deleteSet.has(marker.id)) throw new Error("invalidRange");
    const index = next.findIndex((m) => m.id === marker.id);
    if (index === -1) throw new Error("invalidRange");
    if (marker !== next[index]) {
      next = next.map((m, i) => (i === index ? marker : m));
      updated.push(marker);
    }
  }
  next = next.filter((m) => !deleteSet.has(m.id));
  const created = (opts.creates ?? []).map(validateTimelineMarker);
  next = sortMarkers([...next, ...created]);
  if (next.length === before.length && next.every((m, i) => m === before[i])) {
    return { created: [], updated: [], deletedIds: [], timeline };
  }
  return {
    created,
    updated,
    deletedIds: deleteIds,
    timeline: { ...timeline, markers: next },
  };
}

export function changeTimelineMarkersCommand(
  opts: { creates?: TimelineMarker[]; updates?: TimelineMarker[]; deleteIds?: string[] },
  label: string,
): Command {
  return {
    label,
    apply(timeline) {
      return changeTimelineMarkers(timeline, opts).timeline;
    },
  };
}
