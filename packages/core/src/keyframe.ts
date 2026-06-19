export type Interpolation = "linear" | "hold" | "smooth";

export interface Keyframe<V> {
  frame: number;
  value: V;
  interpolationOut: Interpolation;
}

export interface KeyframeTrack<V> {
  keyframes: Keyframe<V>[];
}

export interface AnimPair {
  a: number;
  b: number;
}

export function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

export function lerpNumber(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpAnimPair(a: AnimPair, b: AnimPair, t: number): AnimPair {
  return { a: lerpNumber(a.a, b.a, t), b: lerpNumber(a.b, b.b, t) };
}

export function trackIsActive(track: KeyframeTrack<unknown> | undefined): boolean {
  return !!track && track.keyframes.length > 0;
}

export function sampleTrack<V>(
  track: KeyframeTrack<V>,
  frame: number,
  fallback: V,
  lerp: (a: V, b: V, t: number) => V,
): V {
  const kfs = track.keyframes;
  if (kfs.length === 0) return fallback;
  if (kfs.length === 1) return kfs[0]!.value;
  if (frame <= kfs[0]!.frame) return kfs[0]!.value;
  const last = kfs[kfs.length - 1]!;
  if (frame >= last.frame) return last.value;

  const bIdx = kfs.findIndex((k) => k.frame > frame);
  if (bIdx <= 0) return last.value;
  const a = kfs[bIdx - 1]!;
  const b = kfs[bIdx]!;
  const raw = (frame - a.frame) / (b.frame - a.frame);
  switch (a.interpolationOut) {
    case "hold":
      return a.value;
    case "linear":
      return lerp(a.value, b.value, raw);
    case "smooth":
      return lerp(a.value, b.value, smoothstep(raw));
  }
}

export function upsertKeyframe<V>(track: KeyframeTrack<V>, kf: Keyframe<V>): KeyframeTrack<V> {
  const kfs = track.keyframes.filter((k) => k.frame !== kf.frame);
  const at = kfs.findIndex((k) => k.frame > kf.frame);
  if (at === -1) kfs.push(kf);
  else kfs.splice(at, 0, kf);
  return { keyframes: kfs };
}

export function removeKeyframeAt<V>(track: KeyframeTrack<V>, frame: number): KeyframeTrack<V> {
  return { keyframes: track.keyframes.filter((k) => k.frame !== frame) };
}
