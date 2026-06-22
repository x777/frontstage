import type { Clip } from "../clip.js";
import type { Timeline } from "../timeline.js";
import { findClip } from "../timeline.js";
import type { Transform, Crop } from "../transform.js";
import type { Command } from "./editor-store.js";

export function removeClipCommand(clipId: string): Command {
  return {
    label: "Remove Clip",
    apply(timeline: Timeline): Timeline {
      const loc = findClip(timeline, clipId);
      if (!loc) return timeline;
      const track = timeline.tracks[loc.trackIndex]!;
      const newTrack = { ...track, clips: track.clips.filter((_, i) => i !== loc.clipIndex) };
      const newTracks = timeline.tracks.map((t, i) => (i === loc.trackIndex ? newTrack : t));
      return { ...timeline, tracks: newTracks };
    },
  };
}

export function setClipPropertyCommand<K extends keyof Clip>(
  clipId: string,
  key: K,
  value: Clip[K],
  coalesceKey?: string,
): Command {
  return {
    label: `Set ${key}`,
    coalesceKey,
    apply(timeline: Timeline): Timeline {
      const loc = findClip(timeline, clipId);
      if (!loc) return timeline;
      const track = timeline.tracks[loc.trackIndex]!;
      const newClip = { ...track.clips[loc.clipIndex]!, [key]: value };
      const newClips = track.clips.map((c, i) => (i === loc.clipIndex ? newClip : c));
      const newTrack = { ...track, clips: newClips };
      const newTracks = timeline.tracks.map((t, i) => (i === loc.trackIndex ? newTrack : t));
      return { ...timeline, tracks: newTracks };
    },
  };
}

export function setClipTransformCommand(
  clipId: string,
  transform: Transform,
  coalesceKey?: string,
): Command {
  return {
    label: "Transform Clip",
    coalesceKey,
    apply(timeline: Timeline): Timeline {
      const loc = findClip(timeline, clipId);
      if (!loc) return timeline;
      const track = timeline.tracks[loc.trackIndex]!;
      const newClip = { ...track.clips[loc.clipIndex]!, transform };
      const newClips = track.clips.map((c, i) => (i === loc.clipIndex ? newClip : c));
      const newTrack = { ...track, clips: newClips };
      const newTracks = timeline.tracks.map((t, i) => (i === loc.trackIndex ? newTrack : t));
      return { ...timeline, tracks: newTracks };
    },
  };
}

export function setClipCropCommand(
  clipId: string,
  crop: Crop,
  coalesceKey?: string,
): Command {
  return {
    label: "Crop Clip",
    coalesceKey,
    apply(timeline: Timeline): Timeline {
      const loc = findClip(timeline, clipId);
      if (!loc) return timeline;
      const track = timeline.tracks[loc.trackIndex]!;
      const newClip = { ...track.clips[loc.clipIndex]!, crop };
      const newClips = track.clips.map((c, i) => (i === loc.clipIndex ? newClip : c));
      const newTrack = { ...track, clips: newClips };
      const newTracks = timeline.tracks.map((t, i) => (i === loc.trackIndex ? newTrack : t));
      return { ...timeline, tracks: newTracks };
    },
  };
}
