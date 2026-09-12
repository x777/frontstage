/** Palmier `WaveformExtractor.samplesPerSecond`. */
export const WAVEFORM_SAMPLES_PER_SECOND = 200;
/** Palmier `WaveformExtractor.noiseFloorDb`. */
export const WAVEFORM_NOISE_FLOOR_DB = -50;
/** Palmier `WaveformExtractor.maxSamples`. */
export const WAVEFORM_MAX_SAMPLES = 240_000;

/**
 * Normalized peak: 0 = loud, 1 = silence. Palmier `WaveformExtractor.normalized(peak:)`.
 */
export function normalizeWaveformPeak(peak: number): number {
  if (!(peak > 0)) return 1;
  const db = 20 * Math.log10(peak);
  const clamped = Math.min(0, Math.max(WAVEFORM_NOISE_FLOOR_DB, db));
  if (clamped === 0) return 0;
  return clamped / WAVEFORM_NOISE_FLOOR_DB;
}

/**
 * Peak envelope from mono PCM, Palmier `WaveformExtractor.peakEnvelope`.
 * `range` is optional source-seconds window; omitted = the whole buffer.
 */
export function peakEnvelopeFromPcm(
  pcm: ArrayLike<number>,
  sampleRate: number,
  range?: { start: number; end: number },
): number[] {
  if (!(sampleRate > 0) || pcm.length === 0) return [];
  const duration = pcm.length / sampleRate;
  const startSec = range ? Math.max(0, range.start) : 0;
  const endSec = range ? Math.min(duration, range.end) : duration;
  const span = endSec - startSec;
  if (!(span > 0) || !Number.isFinite(span)) return [];

  const rate =
    span > 0 && Number.isFinite(span)
      ? Math.min(WAVEFORM_SAMPLES_PER_SECOND, WAVEFORM_MAX_SAMPLES / span)
      : WAVEFORM_SAMPLES_PER_SECOND;
  const hopSize = Math.max(1, Math.round(sampleRate / rate));

  const startSample = Math.floor(startSec * sampleRate);
  const endSample = Math.min(pcm.length, Math.ceil(endSec * sampleRate));

  const out: number[] = [];
  let carryPeak = 0;
  let carryCount = 0;
  for (let i = startSample; i < endSample; i++) {
    const mag = Math.abs(pcm[i]!);
    if (mag > carryPeak) carryPeak = mag;
    carryCount += 1;
    if (carryCount === hopSize) {
      out.push(normalizeWaveformPeak(carryPeak));
      carryPeak = 0;
      carryCount = 0;
    }
  }
  if (carryCount > 0) out.push(normalizeWaveformPeak(carryPeak));
  return out;
}

/**
 * Map a source-window of waveform samples onto `pixelWidth` columns.
 * Each column is the **minimum** (loudest, since 0=loud) of samples in that slice.
 */
export function waveformColumnsForWidth(
  samples: readonly number[],
  pixelWidth: number,
  sourceStartFrac = 0,
  sourceEndFrac = 1,
): number[] {
  const width = Math.max(0, Math.floor(pixelWidth));
  if (width === 0 || samples.length === 0) return [];
  const lo = Math.min(1, Math.max(0, sourceStartFrac));
  const hi = Math.min(1, Math.max(lo, sourceEndFrac));
  const i0 = lo * samples.length;
  const i1 = hi * samples.length;
  const span = i1 - i0;
  if (!(span > 0)) return Array.from({ length: width }, () => 1);
  const cols: number[] = [];
  for (let x = 0; x < width; x++) {
    const a = i0 + (span * x) / width;
    const b = i0 + (span * (x + 1)) / width;
    const s0 = Math.max(0, Math.min(samples.length - 1, Math.floor(a)));
    const s1 = Math.max(s0 + 1, Math.min(samples.length, Math.ceil(b)));
    let min = 1;
    for (let s = s0; s < s1; s++) {
      const v = samples[s]!;
      if (v < min) min = v;
    }
    cols.push(min);
  }
  return cols;
}
