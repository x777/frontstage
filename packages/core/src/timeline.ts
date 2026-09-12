import type { ClipType } from "./clip-type.js";
import { type Clip, clipEndFrame } from "./clip.js";
import type { TimelineMarker } from "./timeline-marker.js";

export interface Track {
  id: string;
  type: ClipType;
  name?: string;
  muted: boolean;
  hidden: boolean;
  syncLocked: boolean;
  displayHeight?: number;
  clips: Clip[];
}

export interface Timeline {
  id?: string;
  name?: string;
  folderId?: string;
  fps: number;
  width: number;
  height: number;
  settingsConfigured: boolean;
  tracks: Track[];
  markers?: TimelineMarker[];
}

export interface ClipLocation {
  trackIndex: number;
  clipIndex: number;
}

export function defaultTimeline(): Timeline {
  return {
    id: crypto.randomUUID(),
    name: "Timeline 1",
    fps: 30,
    width: 1920,
    height: 1080,
    settingsConfigured: false,
    tracks: [],
    markers: [],
  };
}

/** Fill Palmier v0.9.0 identity fields so legacy in-memory fixtures stay valid. */
export function ensureTimeline(t: Timeline): Timeline {
  if (t.id && t.name !== undefined && t.markers) return t;
  return {
    ...t,
    id: t.id ?? crypto.randomUUID(),
    name: t.name ?? "Timeline 1",
    markers: t.markers ?? [],
  };
}

export function timelineMarkers(t: Timeline): TimelineMarker[] {
  return t.markers ?? [];
}

function remapGroupIds(groups: Map<string, string>, id: string | undefined, newId: () => string): string | undefined {
  if (!id) return id;
  let next = groups.get(id);
  if (!next) {
    next = newId();
    groups.set(id, next);
  }
  return next;
}

/** Palmier `Timeline.regenerateIds` — keeps the timeline id, freshens tracks/clips/groups/markers. */
export function freshenTimelineContents(t: Timeline, newId: () => string = () => crypto.randomUUID()): Timeline {
  const groups = new Map<string, string>();
  return {
    ...t,
    markers: timelineMarkers(t).map((m) => ({ ...m, id: newId() })),
    tracks: t.tracks.map((track) => ({
      ...track,
      id: newId(),
      clips: track.clips.map((c) => ({
        ...c,
        id: newId(),
        linkGroupId: remapGroupIds(groups, c.linkGroupId, newId),
        captionGroupId: remapGroupIds(groups, c.captionGroupId, newId),
      })),
    })),
  };
}

/** Fresh track/clip/group/marker ids so a duplicated timeline stays unique project-wide. */
export function regenerateTimelineIds(t: Timeline): Timeline {
  return { ...freshenTimelineContents(t), id: crypto.randomUUID() };
}

export function trackEndFrame(track: Track): number {
  let maxFrame = 0;
  for (const clip of track.clips) maxFrame = Math.max(maxFrame, clipEndFrame(clip));
  return maxFrame;
}

export function timelineTotalFrames(t: Timeline): number {
  let maxFrame = 0;
  for (const track of t.tracks) maxFrame = Math.max(maxFrame, trackEndFrame(track));
  return maxFrame;
}

/** Palmier `Timeline.hasAudioClips`. */
export function timelineHasAudioClips(t: Timeline): boolean {
  return t.tracks.some((tr) => tr.type === "audio" && tr.clips.length > 0);
}

export type TimelineResolver = (id: string) => Timeline | undefined;

/**
 * Palmier `Timeline.reachableTimelines` — BFS over nested sequence clips, excluding self.
 */
export function reachableTimelines(
  root: Timeline,
  resolve: TimelineResolver,
  maxDepth: number = Number.POSITIVE_INFINITY,
): Timeline[] {
  const found: Timeline[] = [];
  const seen = new Set<string>(root.id ? [root.id] : []);
  const queue: { t: Timeline; depth: number }[] = [{ t: root, depth: 0 }];
  let i = 0;
  while (i < queue.length) {
    const { t, depth } = queue[i]!;
    i += 1;
    if (!(depth < maxDepth)) continue;
    for (const track of t.tracks) {
      for (const clip of track.clips) {
        if (clip.sourceClipType !== "sequence") continue;
        if (seen.has(clip.mediaRef)) continue;
        seen.add(clip.mediaRef);
        const child = resolve(clip.mediaRef);
        if (!child) continue;
        found.push(child);
        queue.push({ t: child, depth: depth + 1 });
      }
    }
  }
  return found;
}

/** Unique mediaRefs in first-appearance order — the set an interop export needs timecodes for. */
export function timelineMediaRefs(t: Timeline): string[] {
  const seen = new Set<string>();
  const refs: string[] = [];
  for (const track of t.tracks) {
    for (const clip of track.clips) {
      if (seen.has(clip.mediaRef)) continue;
      seen.add(clip.mediaRef);
      refs.push(clip.mediaRef);
    }
  }
  return refs;
}

export function findClip(t: Timeline, id: string): ClipLocation | null {
  for (let ti = 0; ti < t.tracks.length; ti++) {
    const ci = t.tracks[ti]!.clips.findIndex((c) => c.id === id);
    if (ci !== -1) return { trackIndex: ti, clipIndex: ci };
  }
  return null;
}

export function contiguousClipIds(track: Track, fromEnd: number, excludeId: string): Set<string> {
  const ids = new Set<string>();
  let chainEnd = fromEnd;
  const sorted = [...track.clips].sort((a, b) => a.startFrame - b.startFrame);
  for (const c of sorted) {
    if (c.id === excludeId || c.startFrame < fromEnd) continue;
    if (c.startFrame !== chainEnd) break;
    chainEnd = clipEndFrame(c);
    ids.add(c.id);
  }
  return ids;
}
