import { FrameRenderer, readPixelFactory, type ReadPixelFn, type CompositeLayer } from "@palmier/engine";
import { affineTransform, defaultTransform, defaultCrop } from "@palmier/core";

const W = 200, H = 200;

declare global {
  interface Window { __readPixel: ReadPixelFn; __status: string }
}

function solidFrame(w: number, h: number, css: string): VideoFrame {
  const o = new OffscreenCanvas(w, h);
  const c = o.getContext("2d")!;
  c.fillStyle = css;
  c.fillRect(0, 0, w, h);
  return new VideoFrame(o.transferToImageBitmap(), { timestamp: 0 });
}

async function main() {
  try {
    const canvas = document.getElementById("c") as HTMLCanvasElement;
    canvas.width = W;
    canvas.height = H;
    const r = await FrameRenderer.create(canvas);
    const size = { width: W, height: H };

    const baseFrame = solidFrame(W, H, "rgb(255,0,0)");
    const topFrame = solidFrame(W, H, "rgb(0,0,255)");

    // full = fills canvas: identity transform mapped to full canvas
    const full = affineTransform(defaultTransform(), size, size);
    // half = centered half-size: width:0.5, height:0.5, centered (centerX:0.5, centerY:0.5)
    const half = affineTransform({ ...defaultTransform(), width: 0.5, height: 0.5 }, size, size);

    const layers: CompositeLayer[] = [
      { frame: baseFrame, transform: full, opacity: 1, crop: defaultCrop() },
      { frame: topFrame, transform: half, opacity: 0.5, crop: defaultCrop() },
    ];
    await r.composite(layers, size);
    baseFrame.close();
    topFrame.close();

    window.__readPixel = readPixelFactory(r);
    window.__status = "ok";
    document.getElementById("status")!.textContent = "ok";
  } catch (e) {
    const m = "error: " + (e as Error).message;
    (window as unknown as { __status: string }).__status = m;
    document.getElementById("status")!.textContent = m;
  }
}

void main();
