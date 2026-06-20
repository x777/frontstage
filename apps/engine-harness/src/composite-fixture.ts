import { FrameRenderer, readPixelFactory, ImageSource, type ReadPixelFn, type CompositeLayer } from "@palmier/engine";
import { affineTransform, defaultTransform, defaultCrop } from "@palmier/core";

const W = 200, H = 200;

declare global {
  interface Window { __readPixel: ReadPixelFn; __imageLayerCheck: () => Promise<number[]>; __cropCheck: () => Promise<{ left: number[]; right: number[] }>; __status: string }
}

function solidFrame(w: number, h: number, css: string): VideoFrame {
  const o = new OffscreenCanvas(w, h);
  const c = o.getContext("2d")!;
  c.fillStyle = css;
  c.fillRect(0, 0, w, h);
  return new VideoFrame(o.transferToImageBitmap(), { timestamp: 0 });
}

async function greenImageBlob(): Promise<ArrayBuffer> {
  const o = new OffscreenCanvas(W, H);
  const c = o.getContext("2d")!;
  c.fillStyle = "rgb(0,255,0)";
  c.fillRect(0, 0, W, H);
  const blob = await o.convertToBlob({ type: "image/png" });
  return blob.arrayBuffer();
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

    const imgBytes = await greenImageBlob();
    const imgSource = await ImageSource.create(imgBytes);
    const imgLayers: CompositeLayer[] = [
      { frame: imgSource.frame(), transform: full, opacity: 1, crop: defaultCrop() },
    ];

    const readPixel = readPixelFactory(r);
    window.__readPixel = readPixel;
    window.__imageLayerCheck = async () => {
      await r.composite(imgLayers, size);
      return readPixel(W / 2, H / 2);
    };

    // Crop golden: green full-frame layer cropped to left half (right:0.5)
    const greenFrame = solidFrame(W, H, "rgb(0,255,0)");
    const cropLayer: CompositeLayer[] = [
      { frame: greenFrame, transform: full, opacity: 1, crop: { left: 0, top: 0, right: 0.5, bottom: 0 } },
    ];
    window.__cropCheck = async () => {
      await r.composite(cropLayer, size);
      const left = await readPixel(50, 100);
      const right = await readPixel(150, 100);
      return { left, right };
    };

    window.__status = "ok";
    document.getElementById("status")!.textContent = "ok";
  } catch (e) {
    const m = "error: " + (e as Error).message;
    (window as unknown as { __status: string }).__status = m;
    document.getElementById("status")!.textContent = m;
  }
}

void main();
