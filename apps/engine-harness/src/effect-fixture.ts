import { FrameRenderer, readPixelFactory, type ReadPixelFn, type CompositeLayer } from "@palmier/engine";
import { affineTransform, defaultTransform, defaultCrop, type Effect } from "@palmier/core";

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
    const params = new URLSearchParams(location.search);
    const useEffect = params.get("case") !== "plain"; // default: effect case
    const canvas = document.getElementById("c") as HTMLCanvasElement;
    canvas.width = W;
    canvas.height = H;
    const size = { width: W, height: H };

    // a solid RED frame, full-canvas
    const frame = solidFrame(W, H, "rgb(255,0,0)");

    const r = await FrameRenderer.create(canvas);

    const full = affineTransform(defaultTransform(), size, size);
    const layer: CompositeLayer = { frame, transform: full, opacity: 1, crop: defaultCrop() };
    if (useEffect) {
      const effects: Effect[] = [
        { id: "e", type: "color.saturation", enabled: true, params: { amount: { value: 0 } } },
      ];
      layer.effects = effects;
    }

    await r.composite([layer], size);
    frame.close();

    window.__readPixel = readPixelFactory(r);
    window.__status = "ok";
    document.getElementById("status")!.textContent = "ok";
  } catch (e) {
    const m = "err: " + (e as Error).message;
    window.__status = m;
    document.getElementById("status")!.textContent = m;
  }
}

void main();
