import { expect, test } from "vitest";
import { encodeWavPcm16Mono } from "@frontstage/engine";
import { WaveformCache } from "../src/media/waveform-cache.js";

test("ingestWav builds a non-empty 0=loud / 1=silence envelope from PCM16 WAV", () => {
  const pcm = new Float32Array(16_000);
  for (let i = 0; i < 8_000; i++) pcm[i] = 1;
  const wav = encodeWavPcm16Mono(pcm, 16_000, 16_000);
  const cache = new WaveformCache();
  expect(cache.ingestWav("m1", wav)).toBe(true);
  const samples = cache.samplesFor("m1");
  expect(samples).toBeDefined();
  expect(samples!.length).toBeGreaterThan(0);
  expect(Math.min(...samples!)).toBeLessThan(Math.max(...samples!));
  expect(samples![0]).toBeLessThan(0.1);
  expect(samples![samples!.length - 1]).toBeGreaterThan(0.9);
});

test("ingestWav on a video mediaRef notifies subscribers (shared extract_audio / timeline cache)", () => {
  const pcm = new Float32Array(8_000);
  for (let i = 0; i < 4_000; i++) pcm[i] = 1;
  const wav = encodeWavPcm16Mono(pcm, 16_000, 8_000);
  const cache = new WaveformCache();
  let ticks = 0;
  cache.subscribe(() => {
    ticks += 1;
  });
  expect(cache.ingestWav("video-1", wav)).toBe(true);
  expect(ticks).toBe(1);
  expect(cache.getSnapshot().get("video-1")?.length).toBeGreaterThan(0);
  expect(cache.samplesFor("video-1")).toBe(cache.getSnapshot().get("video-1"));
});
