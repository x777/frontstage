import { clipEndFrame } from "../clip.js";
import type { Clip } from "../clip.js";
import { clampFadesToDuration, setDuration } from "../clip-mutations.js";
import { clipTypesCompatible } from "../clip-type.js";
import { sampleTrack, lerpNumber, lerpAnimPair } from "../keyframe.js";
import type { KeyframeTrack, Keyframe } from "../keyframe.js";
import { lerpCrop } from "../transform.js";
import type { Timeline, Track } from "../timeline.js";
import { findClip } from "../timeline.js";
import type { Command } from "./editor-store.js";
import type { MediaManifestEntry } from "../media.js";
import { computeOverwrite, applyOverwriteToClips } from "../timeline/overwrite.js";
import type { TrackDropTarget } from "../timeline/geometry.js";

// --- Immutable helpers ---

export function replaceTrackClips(timeline: Timeline, trackIndex: number, clips: Clip[]): Timeline {
  if (trackIndex < 0 || trackIndex >= timeline.tracks.length) return timeline;
  const track = timeline.tracks[trackIndex]!;
  const newTrack = { ...track, clips };
  const newTracks = timeline.tracks.map((t, i) => (i === trackIndex ? newTrack : t));
  return { ...timeline, tracks: newTracks };
}

export function replaceClip(
  timeline: Timeline,
  clipId: string,
  updater: (clip: Clip) => Clip,
): Timeline {
  const loc = findClip(timeline, clipId);
  if (!loc) return timeline;
  const track = timeline.tracks[loc.trackIndex]!;
  const clip = track.clips[loc.clipIndex]!;
  const newClip = updater(clip);
  if (newClip === clip) return timeline;
  const newClips = track.clips.map((c, i) => (i === loc.clipIndex ? newClip : c));
  return replaceTrackClips(timeline, loc.trackIndex, newClips);
}

function sortedByStart(clips: Clip[]): Clip[] {
  return [...clips].sort((a, b) => a.startFrame - b.startFrame);
}

// --- moveClipCommand ---

export function moveClipCommand(
  clipId: string,
  toTrackIndex: number,
  toStartFrame: number,
  coalesceKey?: string,
): Command {
  return {
    label: "Move Clip",
    coalesceKey,
    apply(timeline: Timeline): Timeline {
      const loc = findClip(timeline, clipId);
      if (!loc) return timeline;
      if (toTrackIndex < 0 || toTrackIndex >= timeline.tracks.length) return timeline;

      const srcTrack = timeline.tracks[loc.trackIndex]!;
      const clip = srcTrack.clips[loc.clipIndex]!;
      const destTrack = timeline.tracks[toTrackIndex]!;

      if (!clipTypesCompatible(destTrack.type, clip.mediaType)) return timeline;

      const clampedStart = Math.max(0, toStartFrame);
      const movedClip: Clip = { ...clip, startFrame: clampedStart };

      // Remove from source track
      const srcClips = srcTrack.clips.filter((_, i) => i !== loc.clipIndex);

      let newTracks = timeline.tracks.map((t, i) => {
        if (i === loc.trackIndex) return { ...t, clips: srcClips };
        return t;
      });

      // Insert into destination track (may be same as source), overwriting any clips it lands on.
      const existingDest = toTrackIndex === loc.trackIndex ? srcClips : newTracks[toTrackIndex]!.clips;
      const regionEnd = clampedStart + movedClip.durationFrames;
      const cleared = applyOverwriteToClips(existingDest, computeOverwrite(existingDest, clampedStart, regionEnd));
      const destClips = sortedByStart([...cleared, movedClip]);

      newTracks = newTracks.map((t, i) => {
        if (i === toTrackIndex) return { ...t, clips: destClips };
        return t;
      });

      return { ...timeline, tracks: newTracks };
    },
  };
}

// --- trimClipCommand ---

export function trimClipCommand(
  clipId: string,
  edge: "left" | "right",
  deltaFrames: number,
  coalesceKey?: string,
): Command {
  return {
    label: edge === "left" ? "Trim Left" : "Trim Right",
    coalesceKey,
    apply(timeline: Timeline): Timeline {
      if (deltaFrames === 0) return timeline;
      const loc = findClip(timeline, clipId);
      if (!loc) return timeline;

      const track = timeline.tracks[loc.trackIndex]!;
      const clip = track.clips[loc.clipIndex]!;
      const hasNoSource = clip.mediaType === "image" || clip.mediaType === "text";

      // Clamp the trim so the clip never shrinks below 1 frame (over-trim must not go negative).
      const delta = edge === "left"
        ? Math.min(deltaFrames, clip.durationFrames - 1)
        : Math.max(deltaFrames, 1 - clip.durationFrames);

      let newClip: Clip;
      if (edge === "left") {
        const newStart = clip.startFrame + delta;
        const newDuration = clip.durationFrames - delta;
        const newTrimStart = hasNoSource
          ? clip.trimStartFrame
          : clip.trimStartFrame + Math.round(delta * clip.speed);
        newClip = {
          ...setDuration(clip, newDuration),
          startFrame: newStart,
          trimStartFrame: newTrimStart,
        };
      } else {
        const newDuration = clip.durationFrames + delta;
        const newTrimEnd = hasNoSource
          ? clip.trimEndFrame
          : clip.trimEndFrame - Math.round(delta * clip.speed);
        newClip = {
          ...setDuration(clip, newDuration),
          trimEndFrame: newTrimEnd,
        };
      }

      // Re-apply fade clamp in case setDuration didn't fully handle edge interactions
      newClip = clampFadesToDuration(newClip);

      const newClips = sortedByStart(track.clips.map((c, i) => (i === loc.clipIndex ? newClip : c)));
      return replaceTrackClips(timeline, loc.trackIndex, newClips);
    },
  };
}

// --- splitClipCommand ---

// Split one keyframe track at a clip-relative offset: left keeps kfs ≤ offset + a boundary kf;
// right keeps kfs ≥ offset rebased to frame 0 + a boundary kf. Works for any value type via `lerp`.
function splitKeyframeTrackAt<V>(
  track: KeyframeTrack<V>,
  splitOffset: number,
  lerp: (a: V, b: V, t: number) => V,
): { left: KeyframeTrack<V>; right: KeyframeTrack<V> } {
  const boundary = sampleTrack(track, splitOffset, track.keyframes[0]!.value, lerp);
  let leftKfs: Keyframe<V>[] = track.keyframes.filter((k) => k.frame <= splitOffset);
  if (leftKfs.length === 0 || leftKfs[leftKfs.length - 1]!.frame !== splitOffset) {
    leftKfs = [...leftKfs, { frame: splitOffset, value: boundary, interpolationOut: "linear" }];
  }
  let rightKfs: Keyframe<V>[] = track.keyframes
    .filter((k) => k.frame >= splitOffset)
    .map((k) => ({ ...k, frame: k.frame - splitOffset }));
  if (rightKfs.length === 0 || rightKfs[0]!.frame !== 0) {
    rightKfs = [{ frame: 0, value: boundary, interpolationOut: "linear" }, ...rightKfs];
  }
  return { left: { keyframes: leftKfs }, right: { keyframes: rightKfs } };
}

export function splitClipCommand(
  clipId: string,
  atFrame: number,
  coalesceKey?: string,
  newId: () => string = () => crypto.randomUUID(),
): Command {
  return {
    label: "Split Clip",
    coalesceKey,
    apply(timeline: Timeline): Timeline {
      const loc = findClip(timeline, clipId);
      if (!loc) return timeline;

      const track = timeline.tracks[loc.trackIndex]!;
      const clip = track.clips[loc.clipIndex]!;
      const clipEnd = clipEndFrame(clip);

      if (atFrame <= clip.startFrame || atFrame >= clipEnd) return timeline;

      const splitOffset = atFrame - clip.startFrame;
      const leftSource = Math.round(splitOffset * clip.speed);
      const rightSource = Math.round((clip.durationFrames - splitOffset) * clip.speed);

      // Build left clip: shrink to splitOffset, extend trimEnd to preserve right source budget
      let left: Clip = setDuration(
        { ...clip, trimEndFrame: clip.trimEndFrame + rightSource, fadeOutFrames: 0 },
        splitOffset,
      );

      // Build right clip: starts at atFrame, new id, adjusts trimStart
      let right: Clip = setDuration(
        {
          ...clip,
          id: newId(),
          startFrame: atFrame,
          trimStartFrame: clip.trimStartFrame + leftSource,
          fadeInFrames: 0,
        },
        clip.durationFrames - splitOffset,
      );

      // Boundary keyframe continuity for EVERY active track (not just volume): split each at the cut.
      const KF_SPLITS: { key: keyof Clip; lerp: (a: never, b: never, t: number) => never }[] = [
        { key: "opacityTrack", lerp: lerpNumber as never },
        { key: "rotationTrack", lerp: lerpNumber as never },
        { key: "volumeTrack", lerp: lerpNumber as never },
        { key: "positionTrack", lerp: lerpAnimPair as never },
        { key: "scaleTrack", lerp: lerpAnimPair as never },
        { key: "cropTrack", lerp: lerpCrop as never },
      ];
      for (const { key, lerp } of KF_SPLITS) {
        const tr = clip[key] as KeyframeTrack<never> | undefined;
        if (tr && tr.keyframes.length > 0) {
          const { left: lt, right: rt } = splitKeyframeTrackAt(tr, splitOffset, lerp);
          left = { ...left, [key]: lt };
          right = { ...right, [key]: rt };
        }
      }

      const newClips = sortedByStart([
        ...track.clips.map((c, i) => (i === loc.clipIndex ? left : c)),
        right,
      ]);

      return replaceTrackClips(timeline, loc.trackIndex, newClips);
    },
  };
}

// --- clipFromAsset ---

export function clipFromAsset(
  entry: MediaManifestEntry,
  fps: number,
  startFrame: number,
  newId: () => string = () => crypto.randomUUID(),
): Clip {
  const durationFrames = Math.max(1, Math.round(entry.duration * fps));
  return {
    id: newId(),
    mediaRef: entry.id,
    mediaType: entry.type,
    sourceClipType: entry.type,
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
    transform: { centerX: 0.5, centerY: 0.5, width: 1, height: 1, rotation: 0, flipHorizontal: false, flipVertical: false },
    crop: { top: 0, bottom: 0, left: 0, right: 0 },
  };
}

// --- removeTrackCommand ---

export function removeTrackCommand(trackId: string): Command {
  return {
    label: "Remove Track",
    apply(timeline: Timeline): Timeline {
      const idx = timeline.tracks.findIndex((t) => t.id === trackId);
      if (idx === -1) return timeline;
      const newTracks = timeline.tracks.filter((_, i) => i !== idx);
      return { ...timeline, tracks: newTracks };
    },
  };
}

// --- addClipCommand ---

export function addClipCommand(
  entry: MediaManifestEntry,
  target: TrackDropTarget,
  startFrame: number,
  fps: number,
  coalesceKey?: string,
  newId: () => string = () => crypto.randomUUID(),
): Command {
  return {
    label: "Add Clip",
    coalesceKey,
    apply(timeline: Timeline): Timeline {
      const clampedStart = Math.max(0, startFrame);
      const clip = clipFromAsset(entry, fps, clampedStart, newId);

      if (target.kind === "existing") {
        const index = target.index;
        if (index < 0 || index >= timeline.tracks.length) return timeline;
        const track = timeline.tracks[index]!;
        if (!clipTypesCompatible(track.type, clip.mediaType)) return timeline;

        const regionEnd = clampedStart + clip.durationFrames;
        const actions = computeOverwrite(track.clips, clampedStart, regionEnd);
        const cleared = applyOverwriteToClips(track.clips, actions);
        const newClips = sortedByStart([...cleared, clip]);
        return replaceTrackClips(timeline, index, newClips);
      } else {
        // new track
        const trackCount = timeline.tracks.length;
        const clampedIndex = Math.max(0, Math.min(target.index, trackCount));
        const newTrack: Track = {
          id: newId(),
          type: clip.mediaType,
          muted: false,
          hidden: false,
          syncLocked: false,
          clips: [clip],
        };
        const newTracks = [
          ...timeline.tracks.slice(0, clampedIndex),
          newTrack,
          ...timeline.tracks.slice(clampedIndex),
        ];
        return { ...timeline, tracks: newTracks };
      }
    },
  };
}
