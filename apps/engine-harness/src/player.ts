import {
  fitTransform, defaultCrop,
  type Timeline, type Clip,
} from "@palmier/core";
import { demuxMp4, PlaybackEngine, type MediaByteSource } from "@palmier/engine";

declare global {
  interface Window {
    __engine: PlaybackEngine | undefined;
    __engineReady: boolean;
  }
}

window.__engine = undefined;
window.__engineReady = false;

const CLIP_URL = "/test/fixtures/clip.mp4";
const FPS = 30;
const W = 320;
const H = 240;

async function main(): Promise<void> {
  const status = document.getElementById("status")!;

  try {
    // Fetch clip bytes and pre-demux to find duration
    const resp = await fetch(CLIP_URL);
    if (!resp.ok) throw new Error(`fetch ${CLIP_URL}: ${resp.status}`);
    const fileBytes = await resp.arrayBuffer();
    const demux = await demuxMp4(new Blob([fileBytes]));
    if (!demux.video) throw new Error("no video track");

    // Compute duration in frames from last sample
    const samples = demux.video.samples;
    const lastSample = samples[samples.length - 1]!;
    const durationUs = lastSample.cts + Math.round((lastSample.durationTicks / demux.video.timescale) * 1_000_000);
    const durationFrames = Math.max(1, Math.round(durationUs / 1_000_000 * FPS));

    // Build a one-track/one-clip Timeline at 320×240, fps 30
    const natSize = { width: demux.video.codedWidth, height: demux.video.codedHeight };
    const transform = fitTransform(natSize, { width: W, height: H });
    const clip: Clip = {
      id: "clip1",
      mediaRef: "clip",
      mediaType: "video",
      sourceClipType: "video",
      startFrame: 0,
      durationFrames,
      trimStartFrame: 0,
      trimEndFrame: 0,
      speed: 1,
      volume: 1,
      fadeInFrames: 0,
      fadeOutFrames: 0,
      fadeInInterpolation: "linear",
      fadeOutInterpolation: "linear",
      opacity: 1,
      transform,
      crop: defaultCrop(),
    };
    const timeline: Timeline = {
      fps: FPS,
      width: W,
      height: H,
      settingsConfigured: true,
      tracks: [{ id: "track1", type: "video", muted: false, hidden: false, syncLocked: false, clips: [clip] }],
    };

    // MediaByteSource that serves the pre-fetched bytes
    const source: MediaByteSource = {
      open(_ref: string): Promise<Blob> {
        return Promise.resolve(new Blob([fileBytes], { type: "video/mp4" }));
      },
    };

    const canvas = document.getElementById("c") as HTMLCanvasElement;
    const engine = await PlaybackEngine.create(canvas);
    await engine.load(timeline, source);

    // Wire the scrub slider
    const slider = document.getElementById("scrub") as HTMLInputElement;
    slider.max = String(durationFrames - 1);
    slider.value = "0";
    slider.addEventListener("input", () => {
      void engine.seek(Number(slider.value), "scrub");
    });

    // Wire the play/pause button
    const playPauseBtn = document.getElementById("playpause") as HTMLButtonElement;
    playPauseBtn.addEventListener("click", () => {
      if (engine.isPlaying) {
        engine.pause();
        playPauseBtn.textContent = "Play";
      } else {
        engine.play();
        playPauseBtn.textContent = "Pause";
      }
    });
    engine.onStateChange((s) => {
      playPauseBtn.textContent = s.isPlaying ? "Pause" : "Play";
    });

    window.__engine = engine;
    window.__engineReady = true;
    status.textContent = `ok — ${durationFrames} frames`;
  } catch (e) {
    const msg = "error: " + (e as Error).message;
    status.textContent = msg;
    console.error(e);
  }
}

void main();
