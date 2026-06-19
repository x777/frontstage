import type { Clip } from "./clip.js";
import type { KeyframeTrack } from "./keyframe.js";

function clampTrack<V>(track: KeyframeTrack<V> | undefined, duration: number): KeyframeTrack<V> | undefined {
  if (!track) return undefined;
  const kept = track.keyframes.filter((k) => k.frame >= 0 && k.frame <= duration);
  return kept.length === 0 ? undefined : { keyframes: kept };
}

function rescaleTrack<V>(track: KeyframeTrack<V> | undefined, scale: number): KeyframeTrack<V> | undefined {
  if (!track) return undefined;
  if (!Number.isFinite(scale) || scale <= 0) return { keyframes: track.keyframes };
  const moved = track.keyframes.map((k) => ({ ...k, frame: Math.round(k.frame * scale) }));
  // Upsert semantics: later wins on frame collision.
  const byFrame = new Map<number, (typeof moved)[number]>();
  for (const k of moved) byFrame.set(k.frame, k);
  const keyframes = [...byFrame.values()].sort((a, b) => a.frame - b.frame);
  return keyframes.length === 0 ? undefined : { keyframes };
}

export function clampKeyframesToDuration(clip: Clip): Clip {
  const d = clip.durationFrames;
  return {
    ...clip,
    opacityTrack: clampTrack(clip.opacityTrack, d),
    positionTrack: clampTrack(clip.positionTrack, d),
    scaleTrack: clampTrack(clip.scaleTrack, d),
    rotationTrack: clampTrack(clip.rotationTrack, d),
    cropTrack: clampTrack(clip.cropTrack, d),
    volumeTrack: clampTrack(clip.volumeTrack, d),
  };
}

export function clampFadesToDuration(clip: Clip): Clip {
  const fadeInFrames = Math.max(0, Math.min(clip.fadeInFrames, clip.durationFrames));
  const fadeOutFrames = Math.max(0, Math.min(clip.fadeOutFrames, clip.durationFrames - fadeInFrames));
  return { ...clip, fadeInFrames, fadeOutFrames };
}

export function setFade(clip: Clip, edge: "left" | "right", frames: number): Clip {
  const v = Math.max(0, frames);
  const next = edge === "left" ? { ...clip, fadeInFrames: v } : { ...clip, fadeOutFrames: v };
  return clampFadesToDuration(next);
}

export function setDuration(clip: Clip, newDuration: number): Clip {
  return clampFadesToDuration(clampKeyframesToDuration({ ...clip, durationFrames: newDuration }));
}

export function rescaleKeyframes(clip: Clip, scale: number): Clip {
  return {
    ...clip,
    opacityTrack: rescaleTrack(clip.opacityTrack, scale),
    positionTrack: rescaleTrack(clip.positionTrack, scale),
    scaleTrack: rescaleTrack(clip.scaleTrack, scale),
    rotationTrack: rescaleTrack(clip.rotationTrack, scale),
    cropTrack: rescaleTrack(clip.cropTrack, scale),
    volumeTrack: rescaleTrack(clip.volumeTrack, scale),
  };
}
