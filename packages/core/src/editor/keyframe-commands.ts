import type { AnimPair, Interpolation } from "../keyframe.js";
import { upsertKeyframe, removeKeyframeAt } from "../keyframe.js";
import type { Crop } from "../transform.js";
import type { Timeline } from "../timeline.js";
import type { Command } from "./editor-store.js";
import { replaceClip } from "./timeline-commands.js";

export type KeyframeTrackKey =
  | "opacityTrack"
  | "positionTrack"
  | "scaleTrack"
  | "rotationTrack"
  | "cropTrack"
  | "volumeTrack";

export interface KeyframeValueMap {
  opacityTrack: number;
  positionTrack: AnimPair;
  scaleTrack: AnimPair;
  rotationTrack: number;
  cropTrack: Crop;
  volumeTrack: number;
}

/** frame is clip-relative (playhead - clip.startFrame). */
export function setKeyframeCommand<K extends KeyframeTrackKey>(
  clipId: string,
  trackKey: K,
  frame: number,
  value: KeyframeValueMap[K],
  interpolationOut: Interpolation = "linear",
  coalesceKey?: string,
): Command {
  return {
    label: "Set Keyframe",
    coalesceKey,
    apply(timeline: Timeline): Timeline {
      return replaceClip(timeline, clipId, (clip) => {
        const existing = clip[trackKey] as { keyframes: unknown[] } | undefined;
        const track = existing ?? { keyframes: [] };
        const updated = upsertKeyframe(track as never, { frame, value, interpolationOut } as never);
        return { ...clip, [trackKey]: updated };
      });
    },
  };
}

export function removeKeyframeCommand(
  clipId: string,
  trackKey: KeyframeTrackKey,
  frame: number,
  coalesceKey?: string,
): Command {
  return {
    label: "Remove Keyframe",
    coalesceKey,
    apply(timeline: Timeline): Timeline {
      return replaceClip(timeline, clipId, (clip) => {
        const track = clip[trackKey];
        if (!track) return clip;
        if (!track.keyframes.some((k) => k.frame === frame)) return clip;
        const next = removeKeyframeAt(track as never, frame) as { keyframes: unknown[] };
        return { ...clip, [trackKey]: next.keyframes.length === 0 ? undefined : next };
      });
    },
  };
}
