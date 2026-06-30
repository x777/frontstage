import type { Timeline } from "../timeline.js";
import { findClip } from "../timeline.js";
import { expandToLinkGroup } from "../timeline/link-group.js";
import type { GapSelection } from "../timeline/ripple-types.js";

export type SelectForwardScope = "track" | "allTracks";

export function selectForward(timeline: Timeline, anchorClipId: string, scope: SelectForwardScope): Set<string> {
  const anchorLoc = findClip(timeline, anchorClipId);
  if (!anchorLoc) return new Set();
  const anchor = timeline.tracks[anchorLoc.trackIndex]!.clips[anchorLoc.clipIndex]!;
  const ids = new Set<string>();
  for (let ti = 0; ti < timeline.tracks.length; ti++) {
    if (scope !== "allTracks" && ti !== anchorLoc.trackIndex) continue;
    for (const clip of timeline.tracks[ti]!.clips) {
      if (clip.startFrame >= anchor.startFrame) ids.add(clip.id);
    }
  }
  return expandToLinkGroup(timeline, ids);
}

export function forwardSelectionAnchorId(timeline: Timeline, selection: ReadonlySet<string>): string | null {
  let best: { startFrame: number; trackIndex: number; id: string } | null = null;
  for (let ti = 0; ti < timeline.tracks.length; ti++) {
    for (const clip of timeline.tracks[ti]!.clips) {
      if (!selection.has(clip.id)) continue;
      if (
        best === null ||
        clip.startFrame < best.startFrame ||
        (clip.startFrame === best.startFrame && ti < best.trackIndex)
      ) {
        best = { startFrame: clip.startFrame, trackIndex: ti, id: clip.id };
      }
    }
  }
  return best?.id ?? null;
}

export function hitTestGap(timeline: Timeline, trackIndex: number, frame: number): GapSelection | null {
  const track = timeline.tracks[trackIndex];
  if (!track) return null;
  const clips = track.clips;
  if (clips.some((c) => frame >= c.startFrame && frame < c.startFrame + c.durationFrames)) return null;
  const after = clips.map((c) => c.startFrame).filter((s) => s > frame);
  if (after.length === 0) return null;
  const nextStart = Math.min(...after);
  const ends = clips.map((c) => c.startFrame + c.durationFrames).filter((e) => e <= frame);
  const prevEnd = ends.length ? Math.max(...ends) : 0;
  return { trackIndex, range: { start: prevEnd, end: nextStart } };
}
