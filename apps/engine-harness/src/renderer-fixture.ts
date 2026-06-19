import { fitTransform, affineTransform } from "@palmier/core";
import { FrameRenderer, readPixelFactory, type ReadPixelFn } from "@palmier/engine";

const W = 200;
const H = 200;
const VIDEO_W = 320;
const VIDEO_H = 180;

declare global {
  interface Window {
    __readPixel: ReadPixelFn;
    __status: string;
  }
}

async function main(): Promise<void> {
  const status = document.getElementById("status")!;

  try {
    const canvas = document.getElementById("c") as HTMLCanvasElement;
    canvas.width = W;
    canvas.height = H;

    const renderer = await FrameRenderer.create(canvas);

    // Build a solid-red VideoFrame from an OffscreenCanvas
    const offscreen = new OffscreenCanvas(VIDEO_W, VIDEO_H);
    const ctx2d = offscreen.getContext("2d")!;
    ctx2d.fillStyle = "rgb(255,0,0)";
    ctx2d.fillRect(0, 0, VIDEO_W, VIDEO_H);
    const bitmap = offscreen.transferToImageBitmap();
    const frame = new VideoFrame(bitmap, { timestamp: 0 });

    // Letterbox: 320x180 (16:9) into 200x200 (1:1)
    const transform = fitTransform({ width: VIDEO_W, height: VIDEO_H }, { width: W, height: H });
    const mat = affineTransform(transform, { width: VIDEO_W, height: VIDEO_H }, { width: W, height: H });

    renderer.present(frame, mat, { width: W, height: H });
    frame.close();

    window.__readPixel = readPixelFactory(renderer);

    status.textContent = "ok";
    window.__status = "ok";
  } catch (e) {
    const msg = "error: " + (e as Error).message;
    status.textContent = msg;
    window.__status = msg;
  }
}

void main();
