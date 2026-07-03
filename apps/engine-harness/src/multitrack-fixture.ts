import {
  fitTransform, defaultCrop,
  type Timeline, type Clip,
} from "@palmier/core";
import { demuxMp4, PlaybackEngine, type MediaByteSource } from "@palmier/engine";

declare global {
  interface Window {
    __engine: PlaybackEngine | undefined;
    __multitrackReady: boolean;
    __seekFrame: number;
    __readPixel: (x: number, y: number) => Promise<[number, number, number, number]>;
  }
}

window.__engine = undefined;
window.__multitrackReady = false;
window.__seekFrame = 0;

const CLIP_URL = "/test/fixtures/clip.mp4";
const FPS = 30;
const W = 320;
const H = 240;

async function makeGreenPng(): Promise<ArrayBuffer> {
  const oc = new OffscreenCanvas(W, H);
  const ctx = oc.getContext("2d")!;
  ctx.fillStyle = "rgb(0,255,0)";
  ctx.fillRect(0, 0, W, H);
  const blob = await oc.convertToBlob({ type: "image/png" });
  return blob.arrayBuffer();
}

async function main(): Promise<void> {
  const status = document.getElementById("status")!;
  try {
    const [videoResp, greenPngBytes] = await Promise.all([
      fetch(CLIP_URL),
      makeGreenPng(),
    ]);
    if (!videoResp.ok) throw new Error(`fetch ${CLIP_URL}: ${videoResp.status}`);
    const fileBytes = await videoResp.arrayBuffer();
    const demux = await demuxMp4(new Blob([fileBytes]));
    if (!demux.video) throw new Error("no video track");

    const samples = demux.video.samples;
    const lastSample = samples[samples.length - 1]!;
    const durationUs = lastSample.cts + Math.round((lastSample.durationTicks / demux.video.timescale) * 1_000_000);
    const durationFrames = Math.max(2, Math.round(durationUs / 1_000_000 * FPS));

    const natSize = { width: demux.video.codedWidth, height: demux.video.codedHeight };
    const canvasSize = { width: W, height: H };

    // bottom layer (track index 1 — index 0 = top per Swift z-order convention): full-frame video
    // clip, opacity 1
    const bottomTransform = fitTransform(natSize, canvasSize);
    const bottomClip: Clip = {
      id: "clip-bottom",
      mediaRef: "clip.mp4",
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
      transform: bottomTransform,
      crop: defaultCrop(),
    };

    // top layer (track index 0): solid green IMAGE in the upper-left quadrant, opacity 1
    // centerX=0.25, centerY=0.25, width=0.5, height=0.5 → covers top-left 50%×50%
    const topTransform = { ...fitTransform({ width: W, height: H }, canvasSize), width: 0.5, height: 0.5, centerX: 0.25, centerY: 0.25 };
    const topClip: Clip = {
      id: "clip-top",
      mediaRef: "green.png",
      mediaType: "image",
      sourceClipType: "image",
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
      transform: topTransform,
      crop: defaultCrop(),
    };

    const timeline: Timeline = {
      fps: FPS,
      width: W,
      height: H,
      settingsConfigured: true,
      tracks: [
        { id: "track-top", type: "video", muted: false, hidden: false, syncLocked: false, clips: [topClip] },
        { id: "track-bottom", type: "video", muted: false, hidden: false, syncLocked: false, clips: [bottomClip] },
      ],
    };

    const source: MediaByteSource = {
      open(ref: string): Promise<Blob> {
        if (ref === "green.png") return Promise.resolve(new Blob([greenPngBytes], { type: "image/png" }));
        return Promise.resolve(new Blob([fileBytes], { type: "video/mp4" }));
      },
    };

    const canvas = document.getElementById("c") as HTMLCanvasElement;
    const engine = await PlaybackEngine.create(canvas);
    await engine.load(timeline, source);

    // seek to a frame in the middle where both clips are visible
    const seekFrame = Math.floor(durationFrames / 2);
    await engine.seek(seekFrame, "exact");

    window.__engine = engine;
    window.__seekFrame = seekFrame;
    window.__readPixel = (x, y) => engine.readPixel(x, y);

    window.__multitrackReady = true;
    status.textContent = `ok — ${durationFrames} frames, seeked to ${seekFrame}`;
  } catch (e) {
    const msg = "error: " + (e as Error).message;
    status.textContent = msg;
    console.error(e);
  }
}

void main();
