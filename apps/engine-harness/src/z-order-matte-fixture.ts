import { defaultTransform, defaultCrop, type Timeline, type Clip } from "@palmier/core";
import { PlaybackEngine, type MediaByteSource } from "@palmier/engine";

declare global {
  interface Window {
    __zOrderMatteReady: boolean;
    __readPixel: (x: number, y: number) => Promise<[number, number, number, number]>;
  }
}

window.__zOrderMatteReady = false;

const FPS = 30;
const W = 200, H = 200;

async function solidPng(cssColor: string): Promise<ArrayBuffer> {
  const oc = new OffscreenCanvas(W, H);
  const ctx = oc.getContext("2d")!;
  ctx.fillStyle = cssColor;
  ctx.fillRect(0, 0, W, H);
  const blob = await oc.convertToBlob({ type: "image/png" });
  return blob.arrayBuffer();
}

function fullFrameImageClip(id: string, mediaRef: string): Clip {
  return {
    id,
    mediaRef,
    mediaType: "image",
    sourceClipType: "image",
    startFrame: 0,
    durationFrames: 30,
    trimStartFrame: 0,
    trimEndFrame: 0,
    speed: 1,
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    fadeInInterpolation: "linear",
    fadeOutInterpolation: "linear",
    opacity: 1,
    transform: defaultTransform(),
    crop: defaultCrop(),
  };
}

async function main(): Promise<void> {
  const status = document.getElementById("status")!;
  try {
    const [redBytes, blueBytes] = await Promise.all([
      solidPng("rgb(255,0,0)"),
      solidPng("rgb(0,0,255)"),
    ]);

    // H1 regression (M13A review): two full-canvas OPAQUE matte clips on the same span. Swift
    // convention is track index 0 = topmost (CompositionBuilder.swift walks tracks in reverse so
    // index 0 draws last). Track 0 = red, track 1 = blue — if the compositor's z-order ever
    // inverts again, the sampled pixel flips to blue.
    const redClip = fullFrameImageClip("clip-red", "red.png");
    const blueClip = fullFrameImageClip("clip-blue", "blue.png");

    const timeline: Timeline = {
      fps: FPS,
      width: W,
      height: H,
      settingsConfigured: true,
      tracks: [
        { id: "track-red", type: "video", muted: false, hidden: false, syncLocked: false, clips: [redClip] },
        { id: "track-blue", type: "video", muted: false, hidden: false, syncLocked: false, clips: [blueClip] },
      ],
    };

    const source: MediaByteSource = {
      open(ref: string): Promise<Blob> {
        if (ref === "red.png") return Promise.resolve(new Blob([redBytes], { type: "image/png" }));
        if (ref === "blue.png") return Promise.resolve(new Blob([blueBytes], { type: "image/png" }));
        throw new Error(`unexpected mediaRef: ${ref}`);
      },
    };

    const canvas = document.getElementById("c") as HTMLCanvasElement;
    const engine = await PlaybackEngine.create(canvas);
    await engine.load(timeline, source);
    await engine.seek(5, "exact");

    window.__readPixel = (x, y) => engine.readPixel(x, y);

    window.__zOrderMatteReady = true;
    status.textContent = "ok";
  } catch (e) {
    const msg = "error: " + (e as Error).message;
    status.textContent = msg;
    console.error(e);
  }
}

void main();
