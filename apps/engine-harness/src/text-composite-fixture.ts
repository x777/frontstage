import {
  fitTransform, defaultCrop, defaultTransform, defaultTextStyle,
  type Timeline, type Clip,
} from "@frontstage/core";
import { demuxMp4, PlaybackEngine, type MediaByteSource } from "@frontstage/engine";
import type { ReadPixelFn } from "@frontstage/engine";

declare global {
  interface Window {
    __engine: PlaybackEngine | undefined;
    __textCompositeReady: boolean;
    __seekFrame: number;
    __readPixel: ReadPixelFn;
    __maxLuma: (x0: number, y0: number, x1: number, y1: number) => Promise<number>;
  }
}

window.__engine = undefined;
window.__textCompositeReady = false;
window.__seekFrame = 0;

const CLIP_URL = "/test/fixtures/clip.mp4";
const FPS = 30;
const W = 320;
const H = 240;

async function main(): Promise<void> {
  const status = document.getElementById("status")!;
  try {
    const videoResp = await fetch(CLIP_URL);
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
    const videoTransform = fitTransform(natSize, canvasSize);
    const videoClip: Clip = {
      id: "clip-video",
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
      transform: videoTransform,
      crop: defaultCrop(),
    };

    // top layer (track index 0): white "HELLO" text centered
    const textClip: Clip = {
      id: "clip-text",
      mediaRef: "",
      mediaType: "text",
      sourceClipType: "text",
      startFrame: 0,
      durationFrames,
      trimStartFrame: 0,
      trimEndFrame: 0,
      speed: 1,
      volume: 0,
      fadeInFrames: 0,
      fadeOutFrames: 0,
      fadeInInterpolation: "linear",
      fadeOutInterpolation: "linear",
      opacity: 1,
      transform: defaultTransform(),
      crop: defaultCrop(),
      textContent: "HELLO",
      textStyle: {
        ...defaultTextStyle(),
        fontName: "Arial",
        color: { r: 1, g: 1, b: 1, a: 1 },
        fontSize: 48,
        fontScale: 1,
        shadow: { enabled: false, color: { r: 0, g: 0, b: 0, a: 0 }, offsetX: 0, offsetY: 0, blur: 0 },
        background: { enabled: false, color: { r: 0, g: 0, b: 0, a: 0 } },
        border: { enabled: false, color: { r: 0, g: 0, b: 0, a: 0 } },
      },
    };

    const timeline: Timeline = {
      fps: FPS,
      width: W,
      height: H,
      settingsConfigured: true,
      tracks: [
        { id: "track-text", type: "video", muted: false, hidden: false, syncLocked: false, clips: [textClip] },
        { id: "track-video", type: "video", muted: false, hidden: false, syncLocked: false, clips: [videoClip] },
      ],
    };

    // text clip has no media bytes — only open video refs
    const source: MediaByteSource = {
      open(ref: string): Promise<Blob> {
        if (ref === "clip.mp4") return Promise.resolve(new Blob([fileBytes], { type: "video/mp4" }));
        throw new Error(`unexpected mediaRef: ${ref}`);
      },
    };

    const canvas = document.getElementById("c") as HTMLCanvasElement;
    const engine = await PlaybackEngine.create(canvas);
    await engine.load(timeline, source);

    const seekFrame = Math.floor(durationFrames / 2);
    await engine.seek(seekFrame, "exact");

    window.__engine = engine;
    window.__seekFrame = seekFrame;

    window.__readPixel = (x: number, y: number) => engine.readPixel(x, y);
    window.__maxLuma = async (x0: number, y0: number, x1: number, y1: number): Promise<number> => {
      let max = 0;
      for (let y = y0; y < y1; y += 4) {
        for (let x = x0; x < x1; x += 4) {
          const px = await engine.readPixel(x, y);
          const luma = px[0] + px[1] + px[2];
          if (luma > max) max = luma;
        }
      }
      return max;
    };

    window.__textCompositeReady = true;
    status.textContent = `ok — ${durationFrames} frames, seeked to ${seekFrame}`;
  } catch (e) {
    const msg = "error: " + (e as Error).message;
    status.textContent = msg;
    console.error(e);
  }
}

void main();
