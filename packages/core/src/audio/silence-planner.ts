import { WAVEFORM_SAMPLES_PER_SECOND } from "./waveform.js";

/** Palmier `VoiceActivity.chunkDuration` = 512 / 16000. */
export const VOICE_ACTIVITY_CHUNK_DURATION = 512 / 16_000;

export const SILENCE_MINIMUM_PAUSE_RANGE = { min: 0.25, max: 3.0 } as const;
export const SILENCE_SPEECH_PADDING_RANGE = { min: 0.0, max: 0.5 } as const;

export interface SilenceRemovalSettings {
  minimumPauseSeconds: number;
  speechPaddingSeconds: number;
}

export const DEFAULT_SILENCE_REMOVAL_SETTINGS: SilenceRemovalSettings = {
  minimumPauseSeconds: 0.5,
  speechPaddingSeconds: 0.15,
};

export function parseSilenceRemovalSettings(
  minimumPauseSeconds: number,
  speechPaddingSeconds: number,
): SilenceRemovalSettings | null {
  if (
    !Number.isFinite(minimumPauseSeconds) ||
    !Number.isFinite(speechPaddingSeconds) ||
    minimumPauseSeconds < SILENCE_MINIMUM_PAUSE_RANGE.min ||
    minimumPauseSeconds > SILENCE_MINIMUM_PAUSE_RANGE.max ||
    speechPaddingSeconds < SILENCE_SPEECH_PADDING_RANGE.min ||
    speechPaddingSeconds > SILENCE_SPEECH_PADDING_RANGE.max
  ) {
    return null;
  }
  return { minimumPauseSeconds, speechPaddingSeconds };
}

export interface HalfOpenRange {
  start: number;
  end: number;
}

function cellCount(seconds: number, cellDuration: number, maximum: number): number {
  const count = Math.ceil(seconds / cellDuration);
  if (!Number.isFinite(count) || count >= maximum) return maximum;
  return Math.max(0, count);
}

/**
 * Palmier `SilenceRemovalPlanner.removableMask`.
 * `quietNonSpeechMask[i] === true` means cell i is quiet and non-speech.
 */
export function removableMask(
  quietNonSpeechMask: readonly boolean[],
  settings: SilenceRemovalSettings,
  cellDuration: number = VOICE_ACTIVITY_CHUNK_DURATION,
): boolean[] {
  if (quietNonSpeechMask.length === 0 || !Number.isFinite(cellDuration) || !(cellDuration > 0)) return [];
  const minimumCells = cellCount(
    settings.minimumPauseSeconds,
    cellDuration,
    quietNonSpeechMask.length + 1,
  );
  const paddingCells = cellCount(
    settings.speechPaddingSeconds,
    cellDuration,
    quietNonSpeechMask.length,
  );
  const removable = quietNonSpeechMask.map(() => false);
  let i = 0;
  while (i < quietNonSpeechMask.length) {
    if (!quietNonSpeechMask[i]) {
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < quietNonSpeechMask.length && quietNonSpeechMask[j]) j += 1;
    if (j - i >= minimumCells) {
      const start = i + (i > 0 ? paddingCells : 0);
      const end = j - (j < quietNonSpeechMask.length ? paddingCells : 0);
      if (start < end) {
        for (let cell = start; cell < end; cell++) removable[cell] = true;
      }
    }
    i = j;
  }
  return removable;
}

/**
 * Palmier `SilenceRemovalPlanner.visibleRemovableRanges`.
 * Returns half-open ranges in **source-frame** coordinates.
 */
export function visibleRemovableRanges(
  removable: readonly boolean[],
  visibleSourceRange: HalfOpenRange,
  framesPerSecond: number,
  settings: SilenceRemovalSettings,
  cellDuration: number = VOICE_ACTIVITY_CHUNK_DURATION,
): HalfOpenRange[] {
  const cellFrames = cellDuration * Math.max(1, framesPerSecond);
  if (
    !Number.isFinite(cellFrames) ||
    !(cellFrames > 0) ||
    !Number.isFinite(visibleSourceRange.start) ||
    !Number.isFinite(visibleSourceRange.end)
  ) {
    return [];
  }
  const visibleCells: HalfOpenRange = {
    start: visibleSourceRange.start / cellFrames,
    end: visibleSourceRange.end / cellFrames,
  };
  return visibleRemovableCellRanges(removable, visibleCells, settings, cellDuration).map((r) => ({
    start: r.start * cellFrames,
    end: r.end * cellFrames,
  }));
}

function visibleRemovableCellRanges(
  mask: readonly boolean[],
  visibleRange: HalfOpenRange,
  settings: SilenceRemovalSettings,
  cellDuration: number,
): HalfOpenRange[] {
  if (
    mask.length === 0 ||
    !(visibleRange.end > visibleRange.start) ||
    !Number.isFinite(visibleRange.start) ||
    !Number.isFinite(visibleRange.end) ||
    !Number.isFinite(cellDuration) ||
    !(cellDuration > 0)
  ) {
    return [];
  }
  const edgePadding = cellCount(settings.speechPaddingSeconds, cellDuration, mask.length);
  const scanStart = Math.trunc(
    Math.max(0, Math.min(mask.length, Math.floor(visibleRange.start - edgePadding))),
  );
  const scanEnd = Math.trunc(
    Math.max(scanStart, Math.min(mask.length, Math.ceil(visibleRange.end + edgePadding))),
  );
  const ranges: HalfOpenRange[] = [];
  let i = scanStart;
  while (i < scanEnd) {
    if (!mask[i]) {
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < scanEnd && mask[j]) j += 1;
    const expanded = expandingToVisibleEdges({ start: i, end: j }, visibleRange, edgePadding);
    if (expanded.start < visibleRange.end && expanded.end > visibleRange.start) {
      const start = Math.max(expanded.start, visibleRange.start);
      const end = Math.min(expanded.end, visibleRange.end);
      if (start < end) ranges.push({ start, end });
    }
    i = j;
  }
  return ranges;
}

function expandingToVisibleEdges(
  removableRange: HalfOpenRange,
  visibleRange: HalfOpenRange,
  edgePadding: number,
): HalfOpenRange {
  if (!(edgePadding >= 0)) return removableRange;
  const start =
    removableRange.end > visibleRange.start && removableRange.start <= visibleRange.start + edgePadding
      ? visibleRange.start
      : removableRange.start;
  const end =
    removableRange.start < visibleRange.end && removableRange.end >= visibleRange.end - edgePadding
      ? visibleRange.end
      : removableRange.end;
  return { start, end };
}

/** Palmier `SpeechMaskStore` (12 dB speech gap, −28 dB no-speech floor). */
const SPEECH_GAP = 0.24;
const NO_SPEECH_FLOOR = 0.56;

/**
 * Palmier `VoiceActivity.Analysis.chunkCount` = ceil(pcm / 512) at 16 kHz,
 * i.e. ceil(duration / chunkDuration). Waveform envelopes are 200 Hz.
 */
export function vadCellCountForWaveformSamples(
  sampleCount: number,
  samplesPerSecond: number = WAVEFORM_SAMPLES_PER_SECOND,
): number {
  if (!(sampleCount > 0) || !(samplesPerSecond > 0) || !Number.isFinite(sampleCount) || !Number.isFinite(samplesPerSecond)) {
    return 0;
  }
  return Math.max(1, Math.ceil(sampleCount / samplesPerSecond / VOICE_ACTIVITY_CHUNK_DURATION));
}

function cellPeakOf(samples: readonly number[], n: number, c: number): number {
  const s0 = Math.floor((c * samples.length) / n);
  const s1 = Math.min(samples.length, Math.max(s0 + 1, Math.floor(((c + 1) * samples.length) / n)));
  let peak = 1;
  for (let s = s0; s < s1; s++) {
    if (samples[s]! < peak) peak = samples[s]!;
  }
  return peak;
}

/**
 * Quiet-non-speech cells at **VAD rate** from a 200 Hz peak envelope.
 * Palmier `SpeechMaskStore` sizes the mask to the VAD speech array and
 * downsamples the waveform via `cellPeak`. Without VAD, cells louder than
 * the no-speech floor (peak < 0.56) are treated as speech-like so quiet
 * gaps form their own runs; an all-false mask would make the whole file
 * one span and a loud median would hide the pauses. `removableMask`'s
 * default 32 ms `cellDuration` (and the 0.5 s min-pause) stay in real seconds.
 */
export function quietNonSpeechFromWaveform(
  samples: readonly number[],
  speech?: readonly boolean[],
  samplesPerSecond: number = WAVEFORM_SAMPLES_PER_SECOND,
): boolean[] {
  if (samples.length === 0) return [];
  const speechMask: readonly boolean[] =
    speech && speech.length > 0
      ? speech
      : (() => {
          const n = vadCellCountForWaveformSamples(samples.length, samplesPerSecond);
          return Array.from({ length: n }, (_, c) => cellPeakOf(samples, n, c) < NO_SPEECH_FLOOR);
        })();
  if (speechMask.length === 0) return [];
  return buildQuietNonSpeechMask(speechMask, samples);
}

export function buildQuietNonSpeechMask(speech: readonly boolean[], samples: readonly number[]): boolean[] {
  const n = speech.length;
  const cellPeak = (c: number): number => cellPeakOf(samples, n, c);
  const median = (values: number[]): number => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]!;
  };

  const speechPeaks = [];
  for (let c = 0; c < n; c++) if (speech[c]) speechPeaks.push(cellPeak(c));
  const quietFloor = speechPeaks.length === 0 ? NO_SPEECH_FLOOR : Math.min(0.8, Math.max(0.44, median(speechPeaks) + SPEECH_GAP));

  const dead = speech.map(() => false);
  let i = 0;
  while (i < n) {
    if (speech[i]) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < n && !speech[j]) j += 1;
    const peaks: number[] = [];
    for (let c = i; c < j; c++) peaks.push(cellPeak(c));
    if (median(peaks) >= quietFloor) {
      for (let c = i; c < j; c++) dead[c] = true;
    }
    i = j;
  }
  return dead;
}
