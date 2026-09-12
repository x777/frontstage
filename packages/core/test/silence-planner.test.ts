import { describe, expect, test } from "vitest";
import {
  parseSilenceRemovalSettings,
  removableMask,
  visibleRemovableRanges,
  buildQuietNonSpeechMask,
  quietNonSpeechFromWaveform,
  vadCellCountForWaveformSamples,
  DEFAULT_SILENCE_REMOVAL_SETTINGS,
  VOICE_ACTIVITY_CHUNK_DURATION,
  WAVEFORM_SAMPLES_PER_SECOND,
} from "../src/index.js";

describe("Silence removal planner", () => {
  test("filters pauses shorter than minimum", () => {
    const settings = parseSilenceRemovalSettings(0.5, 0)!;
    const mask = removableMask([false, true, true, true, true, false], settings, 0.1);
    expect(mask.includes(true)).toBe(false);
  });

  test("pads both speech boundaries", () => {
    const settings = parseSilenceRemovalSettings(0.5, 0.2)!;
    const mask = removableMask([false, ...Array(10).fill(true), false], settings, 0.1);
    expect(mask).toEqual([false, false, false, ...Array(6).fill(true), false, false, false]);
  });

  test("does not pad source edges", () => {
    const settings = parseSilenceRemovalSettings(0.3, 0.2)!;
    const mask = removableMask([...Array(5).fill(true), false, ...Array(5).fill(true)], settings, 0.1);
    expect(mask).toEqual([true, true, true, false, false, false, false, false, true, true, true]);
  });

  test("removes padding at trimmed clip edges only", () => {
    const settings = parseSilenceRemovalSettings(0.5, 0.2)!;
    const mask = [false, false, true, true, true, true, false, false];
    expect(
      visibleRemovableRanges(mask, { start: 0, end: 9 }, 10, settings, 0.1),
    ).toEqual([{ start: 0, end: 6 }]);
    expect(
      visibleRemovableRanges(mask, { start: -1, end: 8 }, 10, settings, 0.1),
    ).toEqual([{ start: 2, end: 8 }]);
    expect(
      visibleRemovableRanges(mask, { start: -1, end: 9 }, 10, settings, 0.1),
    ).toEqual([{ start: 2, end: 6 }]);
    expect(
      visibleRemovableRanges(mask, { start: 0, end: 1 }, 10, settings, 0.1),
    ).toEqual([{ start: 0, end: 1 }]);
    expect(
      visibleRemovableRanges(mask, { start: 7, end: 8 }, 10, settings, 0.1),
    ).toEqual([{ start: 7, end: 8 }]);
  });

  test("rejects invalid settings", () => {
    expect(parseSilenceRemovalSettings(Number.NaN, 0.15)).toBeNull();
    expect(parseSilenceRemovalSettings(0.1, 0.15)).toBeNull();
    expect(parseSilenceRemovalSettings(0.5, 0.75)).toBeNull();
  });

  test("extreme cell resolution does not overflow", () => {
    const mask = removableMask([true, true], DEFAULT_SILENCE_REMOVAL_SETTINGS, Number.MIN_VALUE);
    expect(mask).toEqual([false, false]);
  });

  test("loud ambience is not treated as dead air", () => {
    const speech = Array(10).fill(false);
    const samples = Array(100).fill(0); // waveform 0 = loud
    expect(buildQuietNonSpeechMask(speech, samples).includes(true)).toBe(false);
  });

  test("true silence is quiet non-speech when no speech is present", () => {
    const speech = Array(10).fill(false);
    const samples = Array(100).fill(1);
    expect(buildQuietNonSpeechMask(speech, samples).every(Boolean)).toBe(true);
  });

  test("200 Hz envelope is resampled onto VAD cells so min-pause is real seconds", () => {
    const settings = parseSilenceRemovalSettings(0.5, 0)!;
    const twoSeconds = 2 * WAVEFORM_SAMPLES_PER_SECOND;
    expect(vadCellCountForWaveformSamples(twoSeconds)).toBe(Math.ceil(2 / VOICE_ACTIVITY_CHUNK_DURATION));

    // 0.4 s quiet then loud — below the 0.5 s min-pause. Treating each 200 Hz
    // sample as a 32 ms VAD cell would stretch 0.4 s to ~2.56 s and wrongly cut.
    const short = [...Array(0.4 * WAVEFORM_SAMPLES_PER_SECOND).fill(1), ...Array(1.6 * WAVEFORM_SAMPLES_PER_SECOND).fill(0)];
    const shortQuiet = quietNonSpeechFromWaveform(short);
    expect(shortQuiet.length).toBe(vadCellCountForWaveformSamples(short.length));
    expect(shortQuiet.length).toBeLessThan(short.length);
    expect(removableMask(shortQuiet, settings).includes(true)).toBe(false);

    const long = [...Array(0.8 * WAVEFORM_SAMPLES_PER_SECOND).fill(1), ...Array(1.2 * WAVEFORM_SAMPLES_PER_SECOND).fill(0)];
    expect(removableMask(quietNonSpeechFromWaveform(long), settings).includes(true)).toBe(true);
  });

  test("rejects non-finite visible source bounds", () => {
    expect(
      visibleRemovableRanges([true], { start: 0, end: Number.POSITIVE_INFINITY }, 30, DEFAULT_SILENCE_REMOVAL_SETTINGS),
    ).toEqual([]);
  });
});
