import type { RGBA } from "./text-style.js";

export const MARKER_NAME_MAX = 120;
export const MARKER_COMMENT_MAX = 4000;
export const MARKER_DEFAULT_COLOR: RGBA = { r: 0, g: 0.478, b: 1, a: 1 };

export type TimelineMarkerStatus = "open" | "review" | "resolved";

export interface TimelineMarker {
  id: string;
  name: string;
  startFrame: number;
  durationFrames: number;
  color: RGBA;
  comment: string;
  status: TimelineMarkerStatus;
}

export type TimelineMarkerValidationError = "invalidName" | "invalidComment" | "invalidRange";

export function markerEndFrame(marker: TimelineMarker): number {
  return marker.startFrame + marker.durationFrames;
}

export function markerIsRange(marker: TimelineMarker): boolean {
  return marker.durationFrames > 0;
}

export function markerIntersects(marker: TimelineMarker, start: number, end: number): boolean {
  return markerIsRange(marker)
    ? marker.startFrame < end && markerEndFrame(marker) > start
    : start <= marker.startFrame && marker.startFrame < end;
}

export function defaultTimelineMarker(partial: Partial<TimelineMarker> & Pick<TimelineMarker, "name" | "startFrame">): TimelineMarker {
  return {
    id: partial.id ?? crypto.randomUUID(),
    name: partial.name,
    startFrame: partial.startFrame,
    durationFrames: partial.durationFrames ?? 0,
    color: partial.color ?? MARKER_DEFAULT_COLOR,
    comment: partial.comment ?? "",
    status: partial.status ?? "open",
  };
}

export function validateTimelineMarker(marker: TimelineMarker): TimelineMarker {
  const name = marker.name.trim();
  if (!name || name.length > MARKER_NAME_MAX || /[\n\r\u0000-\u001f]/.test(name)) {
    throw new Error("invalidName");
  }
  if (marker.comment.length > MARKER_COMMENT_MAX) {
    throw new Error("invalidComment");
  }
  const end = marker.startFrame + marker.durationFrames;
  const channels = [marker.color.r, marker.color.g, marker.color.b, marker.color.a];
  if (
    marker.startFrame < 0 ||
    marker.durationFrames < 0 ||
    !Number.isFinite(end) ||
    end < marker.startFrame ||
    channels.some((c) => !Number.isFinite(c) || c < 0 || c > 1)
  ) {
    throw new Error("invalidRange");
  }
  return { ...marker, name };
}

export function rescaleMarkerFrames(marker: TimelineMarker, scale: number): TimelineMarker {
  const scaledEnd = Math.round(markerEndFrame(marker) * scale);
  const startFrame = Math.max(0, Math.round(marker.startFrame * scale));
  return {
    ...marker,
    startFrame,
    durationFrames: markerIsRange(marker) ? Math.max(1, scaledEnd - startFrame) : 0,
  };
}
