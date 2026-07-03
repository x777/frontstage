// Pure port of Swift's FrameSampler + LumaGrid (Search/Indexing/FrameSampler.swift): candidate-time
// planning, an 8x8 mean-luma fingerprint for scene detection, and the shot-assignment walk (a scene
// change starts a shot; an 8s coverage floor keeps long static shots represented). Callers supply
// already-decoded RGBA frames (T3's canvas frame tap) and a scene-change predicate over those frames.

export const CANDIDATE_INTERVAL_SEC = 2;
export const HIGH_RES_LONG_EDGE_PX = 3000;
export const COVERAGE_FLOOR_SEC = 8;
export const SCENE_DIFF_THRESHOLD = 12;
export const LUMA_GRID_SIZE = 8;

/** Mean luma (Rec.601) per cell of an 8x8 grid over the frame — a cheap visual-change fingerprint. */
export function lumaGrid8x8(rgba: Uint8ClampedArray, width: number, height: number): Float32Array {
  const n = LUMA_GRID_SIZE;
  const sums = new Float32Array(n * n);
  const counts = new Float32Array(n * n);
  if (width > 0 && height > 0) {
    for (let y = 0; y < height; y++) {
      const cellY = Math.min(n - 1, Math.floor((y * n) / height));
      for (let x = 0; x < width; x++) {
        const cellX = Math.min(n - 1, Math.floor((x * n) / width));
        const idx = (y * width + x) * 4;
        const luma = rgba[idx]! * 0.299 + rgba[idx + 1]! * 0.587 + rgba[idx + 2]! * 0.114;
        const cell = cellY * n + cellX;
        sums[cell]! += luma;
        counts[cell]! += 1;
      }
    }
  }
  for (let i = 0; i < n * n; i++) sums[i] = counts[i]! > 0 ? sums[i]! / counts[i]! : 0;
  return sums;
}

/** Mean absolute per-cell difference — Swift's LumaGrid.meanDiff. */
export function gridDiff(a: Float32Array, b: Float32Array): number {
  let diff = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) diff += Math.abs(a[i]! - b[i]!);
  return n > 0 ? diff / n : 0;
}

export interface SamplePlanOptions {
  durationSec: number;
  longEdgePx: number;
}

/** Candidate sample times: interval/2, interval, interval*1.5, ... < duration; doubled above the high-res edge. */
export function candidateTimes(opts: SamplePlanOptions): number[] {
  const { durationSec, longEdgePx } = opts;
  if (!(durationSec > 0)) return [];
  const interval = longEdgePx >= HIGH_RES_LONG_EDGE_PX ? CANDIDATE_INTERVAL_SEC * 2 : CANDIDATE_INTERVAL_SEC;
  const times: number[] = [];
  for (let t = interval / 2; t < durationSec; t += interval) times.push(t);
  if (times.length === 0) times.push(durationSec / 2);
  return times;
}

export interface ShotSample {
  timeSec: number;
  shotStart: number;
  shotEnd: number;
}

/**
 * Walks candidate times, keeping a frame when it's a scene change or the coverage floor has elapsed
 * since the last kept frame (Swift's FrameSampler.sample + VisualIndexer.index shot bookkeeping,
 * fused). The first candidate always starts shot 0 (no prior frame to diff against); a shot's
 * shotStart is 0 for the very first shot (asset start), the cut time for every shot after. A shot's
 * shotEnd is the next shot's start, or its own shotStart when it's the last shot (duration is unknown
 * to this pure function — the caller patches the trailing shotEnd to the asset duration if needed).
 */
export function assignShots(
  times: number[],
  isSceneChange: (i: number) => boolean,
  coverageFloorSec: number = COVERAGE_FLOOR_SEC
): ShotSample[] {
  const shotStarts: number[] = [];
  const shotIndexOf: number[] = [];
  const keptTimes: number[] = [];
  let lastKeptTime = -Infinity;

  for (let i = 0; i < times.length; i++) {
    const t = times[i]!;
    const isNewShot = shotStarts.length === 0 ? true : isSceneChange(i);
    if (!isNewShot && t - lastKeptTime < coverageFloorSec) continue;
    lastKeptTime = t;
    if (isNewShot) shotStarts.push(shotStarts.length === 0 ? 0 : t);
    keptTimes.push(t);
    shotIndexOf.push(shotStarts.length - 1);
  }

  return keptTimes.map((t, idx) => {
    const shot = shotIndexOf[idx]!;
    const shotStart = shotStarts[shot]!;
    const shotEnd = shot + 1 < shotStarts.length ? shotStarts[shot + 1]! : shotStart;
    return { timeSec: t, shotStart, shotEnd };
  });
}
