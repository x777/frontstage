import { type AnimPair, type KeyframeTrack, lerpAnimPair, lerpNumber, sampleTrack, smoothstep, trackIsActive } from "./keyframe.js";
import { type Crop, type Transform, lerpCrop } from "./transform.js";
import { linearFromDb } from "./volume-scale.js";
import type { ClipType } from "./clip-type.js";
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

const keyframeOffset = (clip: Clip, frame: number): number => frame - clip.startFrame;

export function sourceFramesConsumed(clip: Clip): number {
  return Math.round(clip.durationFrames * clip.speed);
}

export function sourceDurationFrames(clip: Clip): number {
  return sourceFramesConsumed(clip) + clip.trimStartFrame + clip.trimEndFrame;
}

export function clipContains(clip: Clip, frame: number): boolean {
  return frame >= clip.startFrame && frame < clipEndFrame(clip);
}

export function fadeMultiplier(clip: Clip, frame: number): number {
  const rel = frame - clip.startFrame;
  if (rel < 0 || rel > clip.durationFrames) return 0;
  const inMul =
    clip.fadeInFrames > 0
      ? (() => {
          const t = Math.min(1, rel / clip.fadeInFrames);
          return clip.fadeInInterpolation === "smooth" ? smoothstep(t) : t;
        })()
      : 1;
  const outRem = clip.durationFrames - rel;
  const outMul =
    clip.fadeOutFrames > 0
      ? (() => {
          const t = Math.min(1, outRem / clip.fadeOutFrames);
          return clip.fadeOutInterpolation === "smooth" ? smoothstep(t) : t;
        })()
      : 1;
  return Math.min(inMul, outMul);
}

export function rawOpacityAt(clip: Clip, frame: number): number {
  return clip.opacityTrack
    ? sampleTrack(clip.opacityTrack, keyframeOffset(clip, frame), clip.opacity, lerpNumber)
    : clip.opacity;
}

export function opacityAt(clip: Clip, frame: number): number {
  const base = rawOpacityAt(clip, frame);
  if (clip.mediaType === "audio" || (clip.fadeInFrames === 0 && clip.fadeOutFrames === 0)) return base;
  return base * fadeMultiplier(clip, frame);
}

export function rotationAt(clip: Clip, frame: number): number {
  return clip.rotationTrack
    ? sampleTrack(clip.rotationTrack, keyframeOffset(clip, frame), clip.transform.rotation, lerpNumber)
    : clip.transform.rotation;
}

export function sizeAt(clip: Clip, frame: number): { width: number; height: number } {
  const fallback: AnimPair = { a: clip.transform.width, b: clip.transform.height };
  const s = clip.scaleTrack
    ? sampleTrack(clip.scaleTrack, keyframeOffset(clip, frame), fallback, lerpAnimPair)
    : fallback;
  return { width: s.a, height: s.b };
}

export function topLeftAt(clip: Clip, frame: number): { x: number; y: number } {
  if (clip.positionTrack && trackIsActive(clip.positionTrack)) {
    const p = sampleTrack(clip.positionTrack, keyframeOffset(clip, frame), { a: 0, b: 0 }, lerpAnimPair);
    return { x: p.a, y: p.b };
  }
  const sz = sizeAt(clip, frame);
  return { x: clip.transform.centerX - sz.width / 2, y: clip.transform.centerY - sz.height / 2 };
}

export function transformAt(clip: Clip, frame: number): Transform {
  const tl = topLeftAt(clip, frame);
  const sz = sizeAt(clip, frame);
  // Preserves flip flags; Swift transformAt drops them (known parity divergence, decision pending).
  return {
    ...clip.transform,
    centerX: tl.x + sz.width / 2,
    centerY: tl.y + sz.height / 2,
    width: sz.width,
    height: sz.height,
    rotation: rotationAt(clip, frame),
  };
}

export function hasTransformAnimation(clip: Clip): boolean {
  return trackIsActive(clip.positionTrack) || trackIsActive(clip.scaleTrack) || trackIsActive(clip.rotationTrack);
}

export function cropAt(clip: Clip, frame: number): Crop {
  return clip.cropTrack
    ? sampleTrack(clip.cropTrack, keyframeOffset(clip, frame), clip.crop, lerpCrop)
    : clip.crop;
}

export function rawVolumeAt(clip: Clip, frame: number): number {
  const kfGain =
    clip.volumeTrack && trackIsActive(clip.volumeTrack)
      ? linearFromDb(sampleTrack(clip.volumeTrack, keyframeOffset(clip, frame), 0, lerpNumber))
      : 1;
  return clip.volume * kfGain;
}

export function volumeAt(clip: Clip, frame: number): number {
  return rawVolumeAt(clip, frame) * fadeMultiplier(clip, frame);
}

export function clipTimelineFrame(clip: Clip, sourceSeconds: number, fps: number): number | null {
  const sourceFrame = sourceSeconds * fps;
  const offsetFromTrim = sourceFrame - clip.trimStartFrame;
  if (offsetFromTrim < 0) return null;
  const frame = Math.round(clip.startFrame + offsetFromTrim / Math.max(clip.speed, 0.0001));
  if (frame < clip.startFrame || frame >= clipEndFrame(clip)) return null;
  return frame;
}
