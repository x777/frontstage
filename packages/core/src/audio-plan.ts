import type { Timeline } from "./timeline.js";
import { clipContains, volumeAt } from "./clip.js";

export interface AudioClipGain {
  clipId: string;
  mediaRef: string;
  gain: number;
  startFrame: number;
  trimStartFrame: number;
  speed: number;
}

export interface AudioPlan {
  clips: AudioClipGain[];
}

export function buildAudioPlan(timeline: Timeline, frame: number): AudioPlan {
  const clips: AudioClipGain[] = [];
  for (const track of timeline.tracks) {
    if (track.hidden) continue;
    for (const clip of track.clips) {
      if (clip.mediaType !== "audio" && clip.mediaType !== "video") continue;
      if (!clipContains(clip, frame)) continue;
      clips.push({
        clipId: clip.id,
        mediaRef: clip.mediaRef,
        gain: volumeAt(clip, frame),
        startFrame: clip.startFrame,
        trimStartFrame: clip.trimStartFrame,
        speed: clip.speed,
      });
    }
  }
  return { clips };
}
