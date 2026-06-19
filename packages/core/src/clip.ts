import type { Crop, Transform } from "./transform.js";
import type { ClipType } from "./clip-type.js";
import type { AnimPair, KeyframeTrack } from "./keyframe.js";
import type { TextStyle } from "./text-style.js";

export interface Clip {
  id: string;
  mediaRef: string;
  mediaType: ClipType;
  sourceClipType: ClipType;
  startFrame: number;
  durationFrames: number;
  trimStartFrame: number;
  trimEndFrame: number;
  speed: number;
  volume: number;
  fadeInFrames: number;
  fadeOutFrames: number;
  fadeInInterpolation: "linear" | "smooth";
  fadeOutInterpolation: "linear" | "smooth";
  opacity: number;
  transform: Transform;
  crop: Crop;
  linkGroupId?: string;
  captionGroupId?: string;
  textContent?: string;
  textStyle?: TextStyle;
  opacityTrack?: KeyframeTrack<number>;
  positionTrack?: KeyframeTrack<AnimPair>;
  scaleTrack?: KeyframeTrack<AnimPair>;
  rotationTrack?: KeyframeTrack<number>;
  cropTrack?: KeyframeTrack<Crop>;
  volumeTrack?: KeyframeTrack<number>;
}

export function clipEndFrame(clip: Clip): number {
  return clip.startFrame + clip.durationFrames;
}
