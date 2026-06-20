import {
  FrameRenderer,
  readPixelFactory,
  TextRasterizer,
  type ReadPixelFn,
  type CompositeLayer,
} from "@palmier/engine";
import { affineTransform, defaultTransform, defaultCrop, defaultTextStyle } from "@palmier/core";
import type { TextLayer } from "@palmier/core";

const W = 200, H = 200;

declare global {
  interface Window {
    __readPixel: ReadPixelFn;
    __maxLuma: (x0: number, y0: number, x1: number, y1: number) => Promise<number>;
    __status: string;
  }
}

function solidFrame(w: number, h: number, cssColor: string): VideoFrame {
  const o = new OffscreenCanvas(w, h);
  const c = o.getContext("2d")!;
  c.fillStyle = cssColor;
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

    const base = solidFrame(W, H, "rgb(0,0,0)");
    const full = affineTransform(defaultTransform(), size, size);

    const rasterizer = new TextRasterizer();

    const layer: TextLayer = {
      clipId: "t",
      text: "HELLO",
      style: {
        ...defaultTextStyle(),
        fontName: "Arial",
        color: { r: 1, g: 1, b: 1, a: 1 },
        fontSize: 48,
        fontScale: 1,
        shadow: { enabled: false, color: { r: 0, g: 0, b: 0, a: 0.6 }, offsetX: 0, offsetY: -2, blur: 6 },
        background: { enabled: false, color: { r: 0, g: 0, b: 0, a: 0.6 } },
        border: { enabled: false, color: { r: 0, g: 0, b: 0, a: 1 } },
      },
      transform: defaultTransform(),
      opacity: 1,
      zIndex: 1,
    };

    const textFrame = rasterizer.rasterize(layer, size);

    const layers: CompositeLayer[] = [
      { frame: base, transform: full, opacity: 1, crop: defaultCrop() },
      { frame: textFrame, transform: full, opacity: 1, crop: defaultCrop() },
    ];

    await r.composite(layers, size);
    base.close();
    rasterizer.dispose();

    const readPixel = readPixelFactory(r);
    window.__readPixel = readPixel;
    window.__maxLuma = async (x0: number, y0: number, x1: number, y1: number): Promise<number> => {
      let max = 0;
      for (let y = y0; y < y1; y += 4) {
        for (let x = x0; x < x1; x += 4) {
          const px = await readPixel(x, y);
          const luma = px[0] + px[1] + px[2];
          if (luma > max) max = luma;
        }
      }
      return max;
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
