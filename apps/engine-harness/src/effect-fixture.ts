import { FrameRenderer, readPixelFactory, type ReadPixelFn, type CompositeLayer } from "@palmier/engine";
import {
  affineTransform, defaultTransform, defaultCrop, type Effect, type BlendMode,
  applyExposure, applyContrast, applyHighlightsShadows, applyBlacksWhites, applyTemperatureTint, applyVibrance,
  applyColorWheels, applyCurves, applyHueCurves, parseGradeCurve, parseHueCurves,
  parseCubeLUT, sampleLUT, blendPixel, applyChromaKey,
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
    __expectedRGBA: [number, number, number, number];
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
    } else if (useCase === "curves") {
      const curveJson = JSON.stringify({ master: [{ x: 0, y: 0 }, { x: 0.5, y: 0.75 }, { x: 1, y: 1 }] });
      const inp = { r: 102 / 255, g: 128 / 255, b: 153 / 255 };
      const f = solidFrame(W, H, "rgb(102,128,153)");
      const layer: CompositeLayer = {
        frame: f, transform: full, opacity: 1, crop: defaultCrop(),
        effects: [{ id: "e", type: "color.curves", enabled: true, params: { curve: { string: curveJson } } }],
      };
      await r.composite([layer], size);
      f.close();
      const expC = applyCurves(inp, parseGradeCurve(curveJson));
      window.__expected = [expC.r, expC.g, expC.b];
    } else if (useCase === "hueCurves") {
      const curvesJson = JSON.stringify({ hueVsHue: [{ x: 0, y: 0.75 }, { x: 1, y: 0.75 }] });
      const inp = { r: 1, g: 0, b: 0 };
      const f = solidFrame(W, H, "rgb(255,0,0)");
      const layer: CompositeLayer = {
        frame: f, transform: full, opacity: 1, crop: defaultCrop(),
        effects: [{ id: "e", type: "color.hueCurves", enabled: true, params: { curves: { string: curvesJson } } }],
      };
      await r.composite([layer], size);
      f.close();
      const expH = applyHueCurves(inp, parseHueCurves(curvesJson));
      window.__expected = [expH.r, expH.g, expH.b];
    } else if (useCase === "lut") {
      // Identity 2³ cube: output = input. Uses MID color.
      const identityCubeText = [
        "LUT_3D_SIZE 2",
        "0 0 0",
        "1 0 0",
        "0 1 0",
        "1 1 0",
        "0 0 1",
        "1 0 1",
        "0 1 1",
        "1 1 1",
      ].join("\n");
      const identityLut = parseCubeLUT(identityCubeText)!;
      const f = solidFrame(W, H, `rgb(${MID_R},${MID_G},${MID_B})`);
      const layer: CompositeLayer = {
        frame: f, transform: full, opacity: 1, crop: defaultCrop(),
        effects: [{ id: "e", type: "color.lut", enabled: true, params: { path: { string: "identity2" }, intensity: { value: 1 } } }],
      };
      r.cubeLUTs.set("identity2", identityLut);
      await r.composite([layer], size);
      f.close();
      window.__expected = [MID_R / 255, MID_G / 255, MID_B / 255];
    } else if (useCase === "lut2") {
      // Non-identity 2³ invert cube: output = (1-r, 1-g, 1-b). Uses MID color.
      const invertCubeText = [
        "LUT_3D_SIZE 2",
        "1 1 1",
        "0 1 1",
        "1 0 1",
        "0 0 1",
        "1 1 0",
        "0 1 0",
        "1 0 0",
        "0 0 0",
      ].join("\n");
      const invertLut = parseCubeLUT(invertCubeText)!;
      const inp = { r: MID_R / 255, g: MID_G / 255, b: MID_B / 255 };
      const f = solidFrame(W, H, `rgb(${MID_R},${MID_G},${MID_B})`);
      const layer: CompositeLayer = {
        frame: f, transform: full, opacity: 1, crop: defaultCrop(),
        effects: [{ id: "e", type: "color.lut", enabled: true, params: { path: { string: "invert2" }, intensity: { value: 1 } } }],
      };
      r.cubeLUTs.set("invert2", invertLut);
      await r.composite([layer], size);
      f.close();
      const expL = sampleLUT(invertLut, inp);
      window.__expected = [expL.r, expL.g, expL.b];
    } else if (useCase.startsWith("blend-")) {
      // Blend mode parity tests: two-layer composite, top=rgb(0.6,0.4,0.8), blendMode=X.
      // HSL modes use a colored bg rgb(0.2,0.5,0.7) so lum/sat differ; separable modes use grey(0.5).
      const modeKey = useCase.slice("blend-".length) as BlendMode;
      const isHsl = (["hue", "saturation", "color", "luminosity"] as string[]).includes(modeKey);
      const bgCss = isHsl ? "rgb(51,128,179)" : "rgb(128,128,128)";
      const bgRef = isHsl ? { r: 0.2, g: 0.5, b: 0.7 } : { r: 0.5, g: 0.5, b: 0.5 };
      const bgFrame = solidFrame(W, H, bgCss);
      const bgLayer: CompositeLayer = { frame: bgFrame, transform: full, opacity: 1, crop: defaultCrop() };
      const topFrame = solidFrame(W, H, "rgb(153,102,204)");
      const topLayer: CompositeLayer = { frame: topFrame, transform: full, opacity: 1, crop: defaultCrop(), blendMode: modeKey };
      await r.composite([bgLayer, topLayer], size);
      bgFrame.close();
      topFrame.close();
      const exp = blendPixel(modeKey, { r: 0.6, g: 0.4, b: 0.8, a: 1 }, { ...bgRef, a: 1 });
      window.__expected = [exp.r, exp.g, exp.b];
    } else if (useCase === "chroma") {
      // Chroma key GPU parity vs applyChromaKey. Green input fully keyed: expected alpha=0, rgb pre-mult=0.
      const inp = { r: 0.1, g: 0.9, b: 0.1, a: 1 };
      const f = solidFrame(W, H, `rgb(${Math.round(inp.r * 255)},${Math.round(inp.g * 255)},${Math.round(inp.b * 255)})`);
      const layer: CompositeLayer = {
        frame: f, transform: full, opacity: 1, crop: defaultCrop(),
        effects: [{ id: "e", type: "key.chroma", enabled: true, params: {
          keyHue: { value: 0.333 }, tolerance: { value: 0.5 }, softness: { value: 0.5 }, spill: { value: 0.5 },
        }}],
      };
      await r.composite([layer], size);
      f.close();
      const exp = applyChromaKey(inp, 0.333, 0.5, 0.5, 0.5);
      window.__expectedRGBA = [exp.r, exp.g, exp.b, exp.a];
    } else if (useCase === "chroma-partial") {
      // Partial chroma key: cyan-teal input (hue≈0.542) sits between inner=0.125 and outer=0.295
      // from keyHue=0.333, so applyChromaKey returns 0 < alpha < 1 and spill-adjusted rgb.
      const inp = { r: 0, g: 153 / 255, b: 204 / 255, a: 1 };
      const f = solidFrame(W, H, `rgb(0, 153, 204)`);
      const layer: CompositeLayer = {
        frame: f, transform: full, opacity: 1, crop: defaultCrop(),
        effects: [{ id: "e", type: "key.chroma", enabled: true, params: {
          keyHue: { value: 0.333 }, tolerance: { value: 0.5 }, softness: { value: 0.5 }, spill: { value: 0.5 },
        }}],
      };
      await r.composite([layer], size);
      f.close();
      const exp = applyChromaKey(inp, 0.333, 0.5, 0.5, 0.5);
      window.__expectedRGBA = [exp.r, exp.g, exp.b, exp.a];
    } else if (useCase === "vignette") {
      // Vignette behavior: white frame, amount=-0.8 should darken corners relative to center.
      const f = solidFrame(W, H, "rgb(255,255,255)");
      const layer: CompositeLayer = {
        frame: f, transform: full, opacity: 1, crop: defaultCrop(),
        effects: [{ id: "e", type: "stylize.vignette", enabled: true, params: {
          amount: { value: -0.8 }, midpoint: { value: 0.3 }, roundness: { value: 0 }, feather: { value: 0.3 },
        }}],
      };
      await r.composite([layer], size);
      f.close();
    } else if (useCase === "grain") {
      // Grain behavior: mid-grey with amount=0.5 should add per-cell noise.
      const f = solidFrame(W, H, "rgb(128,128,128)");
      const layer: CompositeLayer = {
        frame: f, transform: full, opacity: 1, crop: defaultCrop(),
        effects: [{ id: "e", type: "stylize.grain", enabled: true, params: {
          amount: { value: 0.5 }, size: { value: 1 },
        }}],
      };
      await r.composite([layer], size);
      f.close();
    } else if (useCase === "grain-zero") {
      // Grain with amount=0 must be a passthrough: output = input (mid-grey 128).
      const f = solidFrame(W, H, "rgb(128,128,128)");
      const layer: CompositeLayer = {
        frame: f, transform: full, opacity: 1, crop: defaultCrop(),
        effects: [{ id: "e", type: "stylize.grain", enabled: true, params: {
          amount: { value: 0 }, size: { value: 1 },
        }}],
      };
      await r.composite([layer], size);
      f.close();
    } else if (useCase === "gaussian") {
      // Hard vertical step edge: left half black, right half white, edge at x=100.
      const o = new OffscreenCanvas(W, H);
      const c2 = o.getContext("2d")!;
      c2.fillStyle = "rgb(0,0,0)";
      c2.fillRect(0, 0, W / 2, H);
      c2.fillStyle = "rgb(255,255,255)";
      c2.fillRect(W / 2, 0, W / 2, H);
      const f = new VideoFrame(o.transferToImageBitmap(), { timestamp: 0 });
      const layer: CompositeLayer = {
        frame: f, transform: full, opacity: 1, crop: defaultCrop(),
        effects: [{ id: "e", type: "blur.gaussian", enabled: true, params: { radius: { value: 12 } } }],
      };
      await r.composite([layer], size);
      f.close();
    } else if (useCase === "motion") {
      // Horizontal step edge: left half black, right half white. Motion blur at angle=0, radius=20.
      const o = new OffscreenCanvas(W, H);
      const c2 = o.getContext("2d")!;
      c2.fillStyle = "rgb(0,0,0)";
      c2.fillRect(0, 0, W / 2, H);
      c2.fillStyle = "rgb(255,255,255)";
      c2.fillRect(W / 2, 0, W / 2, H);
      const f = new VideoFrame(o.transferToImageBitmap(), { timestamp: 0 });
      const layer: CompositeLayer = {
        frame: f, transform: full, opacity: 1, crop: defaultCrop(),
        effects: [{ id: "e", type: "blur.motion", enabled: true, params: { angle: { value: 0 }, radius: { value: 20 } } }],
      };
      await r.composite([layer], size);
      f.close();
    } else if (useCase === "sharpen") {
      // Soft gradient: left-black to right-white; sharpen amount=1.5 increases edge contrast.
      const o = new OffscreenCanvas(W, H);
      const c2 = o.getContext("2d")!;
      const grd = c2.createLinearGradient(0, 0, W, 0);
      grd.addColorStop(0, "rgb(0,0,0)");
      grd.addColorStop(1, "rgb(255,255,255)");
      c2.fillStyle = grd;
      c2.fillRect(0, 0, W, H);
      const f = new VideoFrame(o.transferToImageBitmap(), { timestamp: 0 });
      const layer: CompositeLayer = {
        frame: f, transform: full, opacity: 1, crop: defaultCrop(),
        effects: [{ id: "e", type: "blur.sharpen", enabled: true, params: { amount: { value: 1.5 } } }],
      };
      await r.composite([layer], size);
      f.close();
    } else if (useCase === "noisered") {
      // Solid mid-grey; amount=0 is passthrough, amount=1 blurs (output same on solid, so we test both).
      const f = solidFrame(W, H, "rgb(128,128,128)");
      const amountStr = params.get("amount") ?? "0";
      const amount = parseFloat(amountStr);
      const layer: CompositeLayer = {
        frame: f, transform: full, opacity: 1, crop: defaultCrop(),
        effects: [{ id: "e", type: "blur.noiseReduction", enabled: true, params: { amount: { value: amount } } }],
      };
      await r.composite([layer], size);
      f.close();
    } else if (useCase === "clarity") {
      // Solid mid-grey; clarity=0 is passthrough, clarity=0.8 enhances local contrast.
      const f = solidFrame(W, H, "rgb(128,128,128)");
      const clarityStr = params.get("clarity") ?? "0";
      const clarity = parseFloat(clarityStr);
      const layer: CompositeLayer = {
        frame: f, transform: full, opacity: 1, crop: defaultCrop(),
        effects: [{ id: "e", type: "detail.clarity", enabled: true, params: { clarity: { value: clarity }, dehaze: { value: 0 } } }],
      };
      await r.composite([layer], size);
      f.close();
    } else if (useCase === "glow") {
      // Small bright spot on black; glow at intensity=1, threshold=0.5, radius=15 bleeds around spot.
      const intensityStr = params.get("intensity") ?? "1";
      const intensity = parseFloat(intensityStr);
      const o = new OffscreenCanvas(W, H);
      const c2 = o.getContext("2d")!;
      c2.fillStyle = "rgb(0,0,0)";
      c2.fillRect(0, 0, W, H);
      c2.fillStyle = "rgb(255,255,255)";
      c2.fillRect(W / 2 - 2, H / 2 - 2, 4, 4); // 4×4 white spot at center
      const f = new VideoFrame(o.transferToImageBitmap(), { timestamp: 0 });
      const layer: CompositeLayer = {
        frame: f, transform: full, opacity: 1, crop: defaultCrop(),
        effects: [{ id: "e", type: "stylize.glow", enabled: true, params: {
          intensity: { value: intensity }, threshold: { value: 0.5 }, radius: { value: 15 }, warmth: { value: 0 },
        }}],
      };
      await r.composite([layer], size);
      f.close();
    } else if (useCase === "chain-exp-gauss") {
      // Solid mid-grey with exposure ev=1 then gaussian radius=1. Exposure brightens; gaussian is no-op on solid color.
      const f = solidFrame(W, H, "rgb(128,128,128)");
      const layer: CompositeLayer = {
        frame: f, transform: full, opacity: 1, crop: defaultCrop(),
        effects: [
          { id: "e1", type: "color.exposure", enabled: true, params: { ev: { value: 1 } } },
          { id: "e2", type: "blur.gaussian", enabled: true, params: { radius: { value: 1 } } },
        ],
      };
      await r.composite([layer], size);
      f.close();
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
