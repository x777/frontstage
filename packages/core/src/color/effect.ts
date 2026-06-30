import type { KeyframeTrack } from "../keyframe.js";
import { sampleTrack, trackIsActive, lerpNumber } from "../keyframe.js";

export interface EffectParam {
  value?: number;
  string?: string;
  track?: KeyframeTrack<number>;
}

export interface Effect {
  id: string;
  type: string;
  enabled: boolean;
  params: Record<string, EffectParam>;
}

// clipFrame is CLIP-RELATIVE (frame - clip.startFrame).
export function resolveParam(p: EffectParam | undefined, clipFrame: number, fallback: number): number {
  if (!p) return fallback;
  if (p.track && trackIsActive(p.track)) return sampleTrack(p.track, clipFrame, fallback, lerpNumber);
  return p.value ?? fallback;
}
