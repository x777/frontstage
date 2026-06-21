import { FrameRenderer } from "@palmier/engine";
import { affineTransform, defaultTransform, defaultCrop } from "@palmier/core";

declare global {
  interface Window {
    desktopSpike: {
      encodeFrame: (rgba: Uint8Array, w: number, h: number) => Promise<string>;
    };
    __spikeStatus: string;
    __spikeResult: string;
  }
}

async function main() {
  try {
    const W = 64, H = 64;

    // Create offscreen canvas and FrameRenderer (WebGPU)
    const offscreen = new OffscreenCanvas(W, H);
    const renderer = await FrameRenderer.create(offscreen);

    // Build a solid red VideoFrame via 2D canvas
    const solid = new OffscreenCanvas(W, H);
    const ctx2d = solid.getContext("2d")!;
    ctx2d.fillStyle = "rgb(255, 0, 0)";
    ctx2d.fillRect(0, 0, W, H);
    const bitmap = solid.transferToImageBitmap();
    const frame = new VideoFrame(bitmap, { timestamp: 0 });

    // Composite the frame (proves WebGPU runs in this renderer)
    const size = { width: W, height: H };
    const fullTransform = affineTransform(defaultTransform(), size, size);
    await renderer.composite(
      [{
        frame,
        transform: fullTransform,
        opacity: 1,
        crop: defaultCrop(),
      }],
      size,
    );
    frame.close();

    // Capture composited result by wrapping the offscreen canvas in a VideoFrame
    const outVf = new VideoFrame(offscreen, { timestamp: 0 });
    const rgba = new Uint8Array(W * H * 4);
    await outVf.copyTo(rgba, { format: "RGBA" });
    outVf.close();

    // Send to main process for ffmpeg encoding
    const outPath = await window.desktopSpike.encodeFrame(rgba, W, H);

    window.__spikeResult = outPath;
    window.__spikeStatus = "ok";
    document.getElementById("status")!.textContent = "ok: " + outPath;
  } catch (e) {
    const msg = "error: " + (e as Error).message;
    window.__spikeStatus = msg;
    document.getElementById("status")!.textContent = msg;
  }
}

void main();
