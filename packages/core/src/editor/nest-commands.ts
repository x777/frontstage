import type { Clip } from "../clip.js";
import { clipEndFrame } from "../clip.js";
import { defaultCrop, defaultTransform } from "../transform.js";
import type { ClipType } from "../clip-type.js";
import { clipTypeCanLinkAudio } from "../clip-type.js";
import { fitTransform } from "../fit-transform.js";
import { nextNestName } from "../project-file.js";
import type { Timeline, Track } from "../timeline.js";
import {
  freshenTimelineContents,
  reachableTimelines,
  timelineHasAudioClips,
  timelineTotalFrames,
  type TimelineResolver,
} from "../timeline.js";
import { computeOverwrite, applyOverwriteToClips } from "../timeline/overwrite.js";
import { computeZones, partitionedInsertionIndex } from "../timeline/zones.js";
import type { TrackDropTarget } from "../timeline/geometry.js";
import type { Command } from "./editor-store.js";
import { replaceTrackClips, resolveOrCreateAudioTrack } from "./timeline-commands.js";
import { pruneEmptyTracks } from "./track-commands.js";
import { clampFadesToDuration, clampKeyframesToDuration, rebaseKeyframeTracks } from "../clip-mutations.js";

function sortedByStart(clips: Clip[]): Clip[] {
  return [...clips].sort((a, b) => a.startFrame - b.startFrame);
}

function sequenceCarrier(
  child: Timeline,
  startFrame: number,
  durationFrames: number,
  mediaType: "sequence" | "audio",
  newId: () => string,
  linkGroupId: string | undefined,
): Clip {
  return {
    id: newId(),
    mediaRef: child.id!,
    mediaType,
    sourceClipType: "sequence",
    startFrame,
    durationFrames,
    trimStartFrame: 0,
    trimEndFrame: 0,
    speed: 1,
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    fadeInInterpolation: "linear",
    fadeOutInterpolation: "linear",
    opacity: 1,
    transform: defaultTransform(),
    crop: defaultCrop(),
    linkGroupId,
  };
}

/** Palmier `EditorViewModel.wouldCreateNestCycle`. */
export function wouldCreateNestCycle(
  childId: string,
  hostId: string,
  resolve: TimelineResolver,
): boolean {
  if (childId === hostId) return true;
  const child = resolve(childId);
  if (!child) return false;
  return reachableTimelines(child, resolve).some((t) => t.id === hostId);
}

/** Palmier `EditorViewModel.nestBlockReason`. */
export function nestBlockReason(
  child: Timeline,
  hostId: string,
  resolve: TimelineResolver,
): string | undefined {
  const name = child.name ?? "Timeline";
  if (timelineTotalFrames(child) === 0) {
    return `"${name}" is empty. Add clips before nesting it.`;
  }
  if (child.id && wouldCreateNestCycle(child.id, hostId, resolve)) {
    return `Can't nest "${name}" — it would contain itself.`;
  }
  return undefined;
}

/**
 * Palmier `nestTimeline` / `insertNestCarriers`.
 * Places `child` onto the host as a sequence clip (video track) with an optional linked audio partner.
 */
export function nestTimelineCommand(
  child: Timeline,
  startFrame: number,
  cursor: TrackDropTarget,
  newId: () => string = () => crypto.randomUUID(),
): Command {
  return {
    label: "Nest Timeline",
    apply(timeline: Timeline): Timeline {
      const duration = timelineTotalFrames(child);
      if (duration <= 0 || !child.id) return timeline;
      const start = Math.max(0, startFrame);
      let videoTarget: TrackDropTarget = cursor;
      if (cursor.kind === "existing") {
        const track = timeline.tracks[cursor.index];
        if (!track || track.type === "audio") videoTarget = { kind: "new", index: 0 };
      }

      const hasAudio = timelineHasAudioClips(child);
      const visualId = newId();
      const linkGroupId = hasAudio ? newId() : undefined;
      const visual: Clip = {
        ...sequenceCarrier(child, start, duration, "sequence", () => visualId, linkGroupId),
        id: visualId,
        transform: fitTransform(
          { width: child.width, height: child.height },
          { width: timeline.width, height: timeline.height },
        ),
      };

      let next: Timeline;
      if (videoTarget.kind === "existing") {
        const index = videoTarget.index;
        if (index < 0 || index >= timeline.tracks.length) return timeline;
        const track = timeline.tracks[index]!;
        if (track.type === "audio") return timeline;
        const regionEnd = start + duration;
        const cleared = applyOverwriteToClips(track.clips, computeOverwrite(track.clips, start, regionEnd));
        next = replaceTrackClips(timeline, index, sortedByStart([...cleared, visual]));
      } else {
        const trackCount = timeline.tracks.length;
        const clampedIndex = Math.max(0, Math.min(videoTarget.index, trackCount));
        const newTrack: Track = {
          id: newId(),
          type: "video",
          muted: false,
          hidden: false,
          syncLocked: false,
          clips: [visual],
        };
        next = {
          ...timeline,
          tracks: [...timeline.tracks.slice(0, clampedIndex), newTrack, ...timeline.tracks.slice(clampedIndex)],
        };
      }

      if (!hasAudio || !clipTypeCanLinkAudio("sequence")) return next;
      const audio: Clip = sequenceCarrier(child, start, duration, "audio", newId, linkGroupId);
      const resolved = resolveOrCreateAudioTrack(next, start, duration, newId);
      const at = resolved.timeline.tracks[resolved.trackIndex]!;
      const aCleared = applyOverwriteToClips(at.clips, computeOverwrite(at.clips, start, start + duration));
      return replaceTrackClips(resolved.timeline, resolved.trackIndex, sortedByStart([...aCleared, audio]));
    },
  };
}

function insertEmptyTrack(timeline: Timeline, at: number, type: ClipType, newId: () => string): { timeline: Timeline; index: number } {
  const clamped = partitionedInsertionIndex(computeZones(timeline), type, at);
  const track: Track = { id: newId(), type, muted: false, hidden: false, syncLocked: false, clips: [] };
  return {
    timeline: {
      ...timeline,
      tracks: [...timeline.tracks.slice(0, clamped), track, ...timeline.tracks.slice(clamped)],
    },
    index: clamped,
  };
}

function trackOverlapsSpan(timeline: Timeline, idx: number, start: number, end: number): boolean {
  const track = timeline.tracks[idx];
  if (!track) return true;
  return track.clips.some((c) => c.startFrame < end && clipEndFrame(c) > start);
}

function placeCarrierOnTrack(
  timeline: Timeline,
  trackIndex: number,
  clip: Clip,
): Timeline {
  const track = timeline.tracks[trackIndex];
  if (!track) return timeline;
  const regionEnd = clip.startFrame + clip.durationFrames;
  const cleared = applyOverwriteToClips(track.clips, computeOverwrite(track.clips, clip.startFrame, regionEnd));
  return replaceTrackClips(timeline, trackIndex, sortedByStart([...cleared, clip]));
}

export interface NestSelectedResult {
  child: Timeline;
  parent: Timeline;
  carrierIds: string[];
}

/**
 * Palmier `nestSelectedClips` — moves the selection into a new nested timeline and
 * leaves linked sequence carriers on the parent.
 */
export function planNestSelectedClips(
  parent: Timeline,
  selectedIds: ReadonlySet<string>,
  existingTimelines: readonly Timeline[],
  newId: () => string = () => crypto.randomUUID(),
): NestSelectedResult | null {
  const lanes: { index: number; type: ClipType; clips: Clip[] }[] = [];
  for (let i = 0; i < parent.tracks.length; i++) {
    const track = parent.tracks[i]!;
    const picked = track.clips.filter((c) => selectedIds.has(c.id));
    if (picked.length > 0) lanes.push({ index: i, type: track.type, clips: picked });
  }
  if (lanes.length === 0) return null;

  const all = lanes.flatMap((l) => l.clips);
  const start = Math.min(...all.map((c) => c.startFrame));
  const duration = Math.max(...all.map((c) => clipEndFrame(c))) - start;

  let child: Timeline = {
    id: newId(),
    name: nextNestName(existingTimelines),
    fps: parent.fps,
    width: parent.width,
    height: parent.height,
    settingsConfigured: parent.settingsConfigured,
    markers: [],
    tracks: lanes.map((lane) => ({
      id: newId(),
      type: lane.type,
      muted: false,
      hidden: false,
      syncLocked: false,
      clips: lane.clips.map((c) => ({ ...c, startFrame: c.startFrame - start })),
    })),
  };
  child = freshenTimelineContents(child, newId);

  let next: Timeline = {
    ...parent,
    tracks: parent.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => !selectedIds.has(c.id)) })),
  };
  const spanEnd = start + duration;
  let videoIdx = lanes.find((l) => l.type !== "audio")?.index;
  let audioIdx = lanes.find((l) => l.type === "audio")?.index;

  if (videoIdx !== undefined && trackOverlapsSpan(next, videoIdx, start, spanEnd)) {
    const inserted = insertEmptyTrack(next, videoIdx, "video", newId);
    next = inserted.timeline;
    if (audioIdx !== undefined && audioIdx >= inserted.index) audioIdx += 1;
    videoIdx = inserted.index;
  }
  if (audioIdx !== undefined && trackOverlapsSpan(next, audioIdx, start, spanEnd)) {
    const inserted = insertEmptyTrack(next, audioIdx + 1, "audio", newId);
    next = inserted.timeline;
    audioIdx = inserted.index;
  }

  const hasVideo = videoIdx !== undefined;
  const hasAudio = audioIdx !== undefined;
  const linkGroupId = hasVideo && hasAudio ? newId() : undefined;
  const carrierIds: string[] = [];

  if (videoIdx !== undefined) {
    const visualId = newId();
    const visual: Clip = {
      ...sequenceCarrier(child, start, duration, "sequence", () => visualId, linkGroupId),
      id: visualId,
      transform: fitTransform(
        { width: child.width, height: child.height },
        { width: parent.width, height: parent.height },
      ),
    };
    next = placeCarrierOnTrack(next, videoIdx, visual);
    carrierIds.push(visualId);
  }
  if (audioIdx !== undefined) {
    const audio = sequenceCarrier(child, start, duration, "audio", newId, linkGroupId);
    next = placeCarrierOnTrack(next, audioIdx, audio);
    carrierIds.push(audio.id);
  }

  return { child, parent: pruneEmptyTracks(next), carrierIds };
}

export interface FlattenedNest {
  videoTracks: Clip[][];
  audioTracks: Clip[][];
}

/** Palmier `NestFlattener.remap`. */
function remapFlattenClip(clip: Clip, windowStart: number, windowEnd: number, shift: number, nestId: string): Clip | null {
  const start = Math.max(clip.startFrame, windowStart);
  const end = Math.min(clipEndFrame(clip), windowEnd);
  if (!(end > start)) return null;
  const headCut = start - clip.startFrame;
  let c: Clip = { ...clip, id: `${nestId}/${clip.id}` };
  if (headCut > 0) {
    c = {
      ...c,
      trimStartFrame: c.trimStartFrame + Math.round(headCut * c.speed),
      fadeInFrames: 0,
    };
    c = rebaseKeyframeTracks(c, headCut);
  }
  if (end < clipEndFrame(clip)) c = { ...c, fadeOutFrames: 0 };
  c = { ...c, startFrame: start + shift, durationFrames: end - start };
  return clampKeyframesToDuration(clampFadesToDuration(c));
}

/** Palmier `NestFlattener.flatten`. */
export function flattenNestCarrier(carrier: Clip, child: Timeline, visual: boolean): FlattenedNest {
  const windowStart = carrier.trimStartFrame;
  const windowEnd = carrier.trimStartFrame + carrier.durationFrames;
  const shift = carrier.startFrame - carrier.trimStartFrame;
  const videoTracks: Clip[][] = [];
  const audioTracks: Clip[][] = [];
  for (const track of child.tracks) {
    if (visual) {
      if (track.type === "audio" || track.hidden) continue;
      const clips = [...track.clips]
        .sort((a, b) => a.startFrame - b.startFrame)
        .flatMap((c) => {
          const m = remapFlattenClip(c, windowStart, windowEnd, shift, carrier.id);
          return m ? [m] : [];
        });
      if (clips.length > 0) videoTracks.push(clips);
    } else {
      if (track.type !== "audio" || track.muted) continue;
      const clips = [...track.clips]
        .sort((a, b) => a.startFrame - b.startFrame)
        .flatMap((c) => {
          const m = remapFlattenClip(c, windowStart, windowEnd, shift, carrier.id);
          return m ? [m] : [];
        });
      if (clips.length > 0) audioTracks.push(clips);
    }
  }
  return { videoTracks, audioTracks };
}

function freshenClip(clip: Clip, groups: Map<string, string>, newId: () => string, volumeScale: number): Clip {
  const remap = (id: string | undefined) => {
    if (!id) return id;
    let next = groups.get(id);
    if (!next) {
      next = newId();
      groups.set(id, next);
    }
    return next;
  };
  return { ...clip, id: newId(), linkGroupId: remap(clip.linkGroupId), captionGroupId: remap(clip.captionGroupId), volume: clip.volume * volumeScale };
}

function placeLanes(
  timeline: Timeline,
  lanes: Clip[][],
  carrier: Clip,
  type: ClipType,
  volumeScale: number,
  groups: Map<string, string>,
  newId: () => string,
): Timeline {
  const locTrack = timeline.tracks.findIndex((t) => t.clips.some((c) => c.id === carrier.id));
  if (locTrack < 0) return timeline;
  const spanStart = carrier.startFrame;
  const spanEnd = clipEndFrame(carrier);
  let next: Timeline = {
    ...timeline,
    tracks: timeline.tracks.map((t, i) =>
      i === locTrack ? { ...t, clips: t.clips.filter((c) => c.id !== carrier.id) } : t,
    ),
  };
  let idx = locTrack;
  for (const lane of lanes) {
    const free =
      next.tracks[idx] !== undefined &&
      next.tracks[idx]!.type === type &&
      !next.tracks[idx]!.clips.some((c) => c.startFrame < spanEnd && clipEndFrame(c) > spanStart);
    if (!free) {
      const inserted = insertEmptyTrack(next, idx, type, newId);
      next = inserted.timeline;
      idx = inserted.index;
    }
    const fresh = lane.map((c) => freshenClip(c, groups, newId, volumeScale));
    const track = next.tracks[idx]!;
    next = replaceTrackClips(next, idx, sortedByStart([...track.clips, ...fresh]));
    idx += 1;
  }
  return next;
}

function carrierHasGroupLook(clip: Clip, child: Timeline): boolean {
  const fitted = fitTransform({ width: child.width, height: child.height }, { width: child.width, height: child.height });
  const t = clip.transform;
  const crop = clip.crop;
  return (
    clip.opacity !== 1 ||
    crop.left !== 0 ||
    crop.top !== 0 ||
    crop.right !== 0 ||
    crop.bottom !== 0 ||
    (clip.effects?.length ?? 0) > 0 ||
    clip.fadeInFrames > 0 ||
    clip.fadeOutFrames > 0 ||
    clip.blendMode !== undefined ||
    clip.opacityTrack !== undefined ||
    clip.positionTrack !== undefined ||
    clip.scaleTrack !== undefined ||
    clip.rotationTrack !== undefined ||
    clip.cropTrack !== undefined ||
    t.centerX !== fitted.centerX ||
    t.centerY !== fitted.centerY ||
    t.width !== fitted.width ||
    t.height !== fitted.height ||
    t.rotation !== 0
  );
}

export interface DecomposeNestResult {
  timeline: Timeline;
  discardedGroupLook: boolean;
}

/**
 * Palmier `decomposeNest` — replaces a sequence carrier (and linked audio) with the child's clips.
 */
export function planDecomposeNest(
  parent: Timeline,
  clipId: string,
  child: Timeline,
  newId: () => string = () => crypto.randomUUID(),
): DecomposeNestResult | null {
  const clicked = parent.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
  if (!clicked || clicked.sourceClipType !== "sequence") return null;

  let videoCarrier: Clip | undefined;
  let audioCarrier: Clip | undefined;
  const group = clicked.linkGroupId
    ? parent.tracks.flatMap((t) => t.clips).filter((c) => c.linkGroupId === clicked.linkGroupId && c.sourceClipType === "sequence" && c.mediaRef === clicked.mediaRef)
    : [clicked];
  for (const c of group) {
    if (c.mediaType === "audio") audioCarrier = c;
    else videoCarrier = c;
  }

  const groups = new Map<string, string>();
  let next = parent;
  if (videoCarrier) {
    const lanes = flattenNestCarrier(videoCarrier, child, true).videoTracks;
    next = placeLanes(next, lanes, videoCarrier, "video", 1, groups, newId);
  }
  if (audioCarrier) {
    const lanes = flattenNestCarrier(audioCarrier, child, false).audioTracks;
    next = placeLanes(next, lanes, audioCarrier, "audio", audioCarrier.volume, groups, newId);
  }

  const discardedGroupLook =
    (videoCarrier ? carrierHasGroupLook(videoCarrier, child) : false) ||
    (audioCarrier ? audioCarrier.fadeInFrames > 0 || audioCarrier.fadeOutFrames > 0 || audioCarrier.volumeTrack !== undefined : false);

  return { timeline: pruneEmptyTracks(next), discardedGroupLook };
}
