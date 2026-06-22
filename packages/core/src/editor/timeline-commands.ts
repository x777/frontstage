import { clipEndFrame } from "../clip.js";
import type { Clip } from "../clip.js";
import { clampFadesToDuration, setDuration } from "../clip-mutations.js";
import { clipTypesCompatible } from "../clip-type.js";
import { sampleTrack, lerpNumber } from "../keyframe.js";
import type { KeyframeTrack, Keyframe } from "../keyframe.js";
import type { Timeline } from "../timeline.js";
import { findClip } from "../timeline.js";
import type { Command } from "./editor-store.js";

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

      // Insert into destination track (may be same as source)
      const destClips =
        toTrackIndex === loc.trackIndex
          ? sortedByStart([...srcClips, movedClip])
          : sortedByStart([...(newTracks[toTrackIndex]!.clips), movedClip]);

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

      let newClip: Clip;
      if (edge === "left") {
        const newStart = clip.startFrame + deltaFrames;
        const newDuration = clip.durationFrames - deltaFrames;
        const newTrimStart = hasNoSource
          ? clip.trimStartFrame
          : clip.trimStartFrame + Math.round(deltaFrames * clip.speed);
        newClip = {
          ...setDuration(clip, newDuration),
          startFrame: newStart,
          trimStartFrame: newTrimStart,
        };
      } else {
        const newDuration = clip.durationFrames + deltaFrames;
        const newTrimEnd = hasNoSource
          ? clip.trimEndFrame
          : clip.trimEndFrame - Math.round(deltaFrames * clip.speed);
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

function sampleVolumeTrack(track: KeyframeTrack<number>, frame: number): number {
  return sampleTrack(track, frame, 0, lerpNumber);
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

      // Volume-track boundary keyframe continuity
      const volTrack = clip.volumeTrack;
      if (volTrack && volTrack.keyframes.length > 0) {
        const boundaryDb = sampleVolumeTrack(volTrack, splitOffset);

        // Left keeps kfs at frame <= splitOffset, plus boundary kf
        let leftKfs: Keyframe<number>[] = volTrack.keyframes.filter((k) => k.frame <= splitOffset);
        if (leftKfs.length === 0 || leftKfs[leftKfs.length - 1]!.frame !== splitOffset) {
          leftKfs = [...leftKfs, { frame: splitOffset, value: boundaryDb, interpolationOut: "linear" }];
        }
        left = { ...left, volumeTrack: { keyframes: leftKfs } };

        // Right keeps kfs >= splitOffset, rebased to frame 0, plus frame-0 boundary kf
        let rightKfs: Keyframe<number>[] = volTrack.keyframes
          .filter((k) => k.frame >= splitOffset)
          .map((k) => ({ ...k, frame: k.frame - splitOffset }));
        if (rightKfs.length === 0 || rightKfs[0]!.frame !== 0) {
          rightKfs = [{ frame: 0, value: boundaryDb, interpolationOut: "linear" }, ...rightKfs];
        }
        right = { ...right, volumeTrack: { keyframes: rightKfs } };
      }

      const newClips = sortedByStart([
        ...track.clips.map((c, i) => (i === loc.clipIndex ? left : c)),
        right,
      ]);

      return replaceTrackClips(timeline, loc.trackIndex, newClips);
    },
  };
}
