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

async function main(): Promise<void> {
  const status = document.getElementById("status")!;
  try {
    const resp = await fetch(CLIP_URL);
    if (!resp.ok) throw new Error(`fetch ${CLIP_URL}: ${resp.status}`);
    const fileBytes = await resp.arrayBuffer();
    const demux = await demuxMp4(new Blob([fileBytes]));
    if (!demux.video) throw new Error("no video track");

    const samples = demux.video.samples;
    const lastSample = samples[samples.length - 1]!;
    const durationUs = lastSample.cts + Math.round((lastSample.durationTicks / demux.video.timescale) * 1_000_000);
    const durationFrames = Math.max(2, Math.round(durationUs / 1_000_000 * FPS));

    const natSize = { width: demux.video.codedWidth, height: demux.video.codedHeight };
    const canvasSize = { width: W, height: H };

    // bottom track: full-frame clip, opacity 1
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

    // top track: scaled to upper-left quadrant, opacity 0.5
    // centerX=0.25, centerY=0.25, width=0.5, height=0.5 → top-left 0..50% of canvas
    const topTransform = { ...fitTransform(natSize, canvasSize), width: 0.5, height: 0.5, centerX: 0.25, centerY: 0.25 };
    const topClip: Clip = {
      id: "clip-top",
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
      opacity: 0.5,
      transform: topTransform,
      crop: defaultCrop(),
    };

    const timeline: Timeline = {
      fps: FPS,
      width: W,
      height: H,
      settingsConfigured: true,
      tracks: [
        { id: "track-bottom", type: "video", muted: false, hidden: false, syncLocked: false, clips: [bottomClip] },
        { id: "track-top", type: "video", muted: false, hidden: false, syncLocked: false, clips: [topClip] },
      ],
    };

    const source: MediaByteSource = {
      open(_ref: string): Promise<Blob> {
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
