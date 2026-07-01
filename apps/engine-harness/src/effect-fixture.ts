import { FrameRenderer, readPixelFactory, type ReadPixelFn, type CompositeLayer } from "@palmier/engine";
import {
  affineTransform, defaultTransform, defaultCrop, type Effect,
  applyExposure, applyContrast, applyHighlightsShadows, applyBlacksWhites, applyTemperatureTint, applyVibrance,
  applyColorWheels,
} from "@palmier/core";

const W = 200, H = 200;

// Mid-color for effect parity tests: rgb(153,77,51) ≈ (0.6, 0.3, 0.2) in [0,1].
const MID_R = 153, MID_G = 77, MID_B = 51;
const MID = { r: MID_R / 255, g: MID_G / 255, b: MID_B / 255 };

declare global {
  interface Window {
    __readPixel: ReadPixelFn;
    __status: string;
    __expected: [number, number, number];
  }
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
    const useCase = params.get("case") ?? "fx";
    const canvas = document.getElementById("c") as HTMLCanvasElement;
    canvas.width = W;
    canvas.height = H;
    const size = { width: W, height: H };

    const r = await FrameRenderer.create(canvas);
    const full = affineTransform(defaultTransform(), size, size);

    if (useCase === "plain") {
      // No effects — solid red passes through unchanged.
      const frame = solidFrame(W, H, "rgb(255,0,0)");
      const layer: CompositeLayer = { frame, transform: full, opacity: 1, crop: defaultCrop() };
      await r.composite([layer], size);
      frame.close();
    } else if (useCase === "fx") {
      // Saturation=0 desaturates red to grey.
      const frame = solidFrame(W, H, "rgb(255,0,0)");
      const layer: CompositeLayer = { frame, transform: full, opacity: 1, crop: defaultCrop() };
      layer.effects = [{ id: "e", type: "color.saturation", enabled: true, params: { amount: { value: 0 } } }];
      await r.composite([layer], size);
      frame.close();
    } else {
      // Parity tests: mid-color frame, one effect per case, CPU-expected exported to window.__expected.
      const frame = solidFrame(W, H, `rgb(${MID_R},${MID_G},${MID_B})`);
      const layer: CompositeLayer = { frame, transform: full, opacity: 1, crop: defaultCrop() };

      let effects: Effect[] = [];
      let exp = { r: 0, g: 0, b: 0 };

      switch (useCase) {
        case "exposure":
          effects = [{ id: "e", type: "color.exposure", enabled: true, params: { ev: { value: 1 } } }];
          exp = applyExposure(MID, 1);
          break;
        case "contrast":
          effects = [{ id: "e", type: "color.contrast", enabled: true, params: { amount: { value: 1.3 } } }];
          exp = applyContrast(MID, 1.3);
          break;
        case "highlightsShadows":
          effects = [{ id: "e", type: "color.highlightsShadows", enabled: true, params: { highlights: { value: 0.4 }, shadows: { value: 0.4 } } }];
          exp = applyHighlightsShadows(MID, 0.4, 0.4);
          break;
        case "blacksWhites":
          effects = [{ id: "e", type: "color.blacksWhites", enabled: true, params: { blacks: { value: 0.2 }, whites: { value: 0.2 } } }];
          exp = applyBlacksWhites(MID, 0.2, 0.2);
          break;
        case "temperature":
          effects = [{ id: "e", type: "color.temperature", enabled: true, params: { temperature: { value: 8000 }, tint: { value: 20 } } }];
          exp = applyTemperatureTint(MID, 8000, 20);
          break;
        case "vibrance":
          effects = [{ id: "e", type: "color.vibrance", enabled: true, params: { amount: { value: 0.6 } } }];
          exp = applyVibrance(MID, 0.6);
          break;
        case "wheels":
          effects = [{ id: "e", type: "color.wheels", enabled: true, params: { lift_m: { value: 0.1 } } }];
          exp = applyColorWheels(MID, { x: 0, y: 0, m: 0.1 }, { x: 0, y: 0, m: 1 }, { x: 0, y: 0, m: 1 });
          break;
        case "wheels2":
          effects = [{ id: "e", type: "color.wheels", enabled: true, params: { lift_x: { value: 0.5 }, gain_m: { value: 1.2 } } }];
          exp = applyColorWheels(MID, { x: 0.5, y: 0, m: 0 }, { x: 0, y: 0, m: 1 }, { x: 0, y: 0, m: 1.2 });
          break;
      }

      layer.effects = effects;
      await r.composite([layer], size);
      frame.close();
      window.__expected = [exp.r, exp.g, exp.b];
    }

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
