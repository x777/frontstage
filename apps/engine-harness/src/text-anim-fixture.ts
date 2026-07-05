import {
  FrameRenderer,
  readPixelFactory,
  TextRasterizer,
  layoutWordsLine,
  type ReadPixelFn,
  type CompositeLayer,
} from "@frontstage/engine";
import {
  affineTransform, applyTextLayerAnim, buildRenderPlan, defaultCrop, defaultTransform, defaultTextStyle,
  type Timeline, type Clip, type Track, type RGBA, type TextAnimationPreset,
} from "@frontstage/core";

const W = 300, H = 100;
const WORDS = ["AAA", "BBB", "CCC"];
const FONT_SIZE = 28;
const FONT_NAME = "Arial";

declare global {
  interface Window {
    __readPixel: ReadPixelFn;
    __wordPeak: (index: 0 | 1 | 2) => Promise<[number, number, number]>;
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

const WORD_TIMINGS = [
  { text: WORDS[0]!, startFrame: 0, endFrame: 10 },
  { text: WORDS[1]!, startFrame: 10, endFrame: 20 },
  { text: WORDS[2]!, startFrame: 20, endFrame: 30 },
];

function buildTimeline(preset: TextAnimationPreset, highlightColor?: RGBA): Timeline {
  const textClip: Clip = {
    id: "t", mediaRef: "", mediaType: "text", sourceClipType: "text",
    startFrame: 0, durationFrames: 40, trimStartFrame: 0, trimEndFrame: 0,
    speed: 1, volume: 0, fadeInFrames: 0, fadeOutFrames: 0,
    fadeInInterpolation: "linear", fadeOutInterpolation: "linear", opacity: 1,
    transform: defaultTransform(), crop: defaultCrop(),
    textContent: WORDS.join(" "),
    textStyle: {
      ...defaultTextStyle(),
      fontName: FONT_NAME,
      fontSize: FONT_SIZE,
      fontScale: 1,
      color: { r: 1, g: 1, b: 1, a: 1 },
      shadow: { enabled: false, color: { r: 0, g: 0, b: 0, a: 0 }, offsetX: 0, offsetY: 0, blur: 0 },
      background: { enabled: false, color: { r: 0, g: 0, b: 0, a: 0 } },
      border: { enabled: false, color: { r: 0, g: 0, b: 0, a: 0 } },
    },
    textAnimation: { preset, highlightColor },
    wordTimings: WORD_TIMINGS,
  };
  const track: Track = { id: "tr", type: "video", muted: false, hidden: false, syncLocked: false, clips: [textClip] };
  return { fps: 30, width: W, height: H, settingsConfigured: true, tracks: [track] };
}

async function main() {
  try {
    const params = new URLSearchParams(location.search);
    const useCase = params.get("case") ?? "wordReveal1";
    const canvas = document.getElementById("c") as HTMLCanvasElement;
    canvas.width = W;
    canvas.height = H;
    const size = { width: W, height: H };

    const r = await FrameRenderer.create(canvas);
    const full = affineTransform(defaultTransform(), size, size);
    const rasterizer = new TextRasterizer();

    let timeline: Timeline;
    let frame: number;
    if (useCase === "wordReveal0") { timeline = buildTimeline("wordReveal"); frame = 0; }
    else if (useCase === "wordReveal1") { timeline = buildTimeline("wordReveal"); frame = 5; }
    else if (useCase === "wordRevealAll") { timeline = buildTimeline("wordReveal"); frame = 25; }
    else if (useCase === "highlightPop") { timeline = buildTimeline("highlightPop", { r: 0, g: 1, b: 0, a: 1 }); frame = 15; }
    else throw new Error(`unknown case: ${useCase}`);

    const plan = buildRenderPlan(timeline, frame, new Map());
    const textLayer = plan.textLayers[0];
    if (!textLayer) throw new Error("no textLayer produced");

    const base = solidFrame(W, H, "rgb(0,0,0)");
    const { transform, opacity } = applyTextLayerAnim(textLayer);
    const tf = affineTransform(transform, size, size);
    const textFrame = rasterizer.rasterize(textLayer, size);

    const layers: CompositeLayer[] = [
      { frame: base, transform: full, opacity: 1, crop: defaultCrop() },
      { frame: textFrame, transform: tf, opacity, crop: defaultCrop() },
    ];
    await r.composite(layers, size);
    base.close();
    rasterizer.dispose();

    const readPixel = readPixelFactory(r);
    window.__readPixel = readPixel;

    // Exact per-word x-ranges — same measureText/layoutWordsLine math the rasterizer itself uses
    // (real Canvas2D metrics, not an assumed equal 3-way split), so a "peak" query at word i lands
    // on that word's actual glyphs even though "AAA"/"BBB"/"CCC" don't render at equal widths.
    const scratch = new OffscreenCanvas(W, H).getContext("2d")!;
    scratch.font = `${FONT_SIZE}px ${FONT_NAME}`;
    const spaceWidth = scratch.measureText(" ").width;
    const boxes = layoutWordsLine(WORDS, (w) => scratch.measureText(w).width, spaceWidth, "center", W / 2);

    // Brightest pixel's RGB within a word's box (padded for highlightPop's 1.15x scale) — tells
    // both presence (luma) and color (for the highlightPop case) at that word's position.
    window.__wordPeak = async (index: 0 | 1 | 2): Promise<[number, number, number]> => {
      const box = boxes[index]!;
      // Capped below half the inter-word gap so a padded box never reaches into a neighbor's glyphs.
      const pad = Math.min(box.width * 0.15, spaceWidth * 0.4);
      const x0 = Math.max(0, Math.round(box.x - pad));
      const x1 = Math.min(W, Math.round(box.x + box.width + pad));
      let maxLuma = -1;
      let best: [number, number, number] = [0, 0, 0];
      for (let y = 10; y < H - 10; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          const px = await readPixel(x, y);
          const luma = px[0] + px[1] + px[2];
          if (luma > maxLuma) { maxLuma = luma; best = [px[0], px[1], px[2]]; }
        }
      }
      return best;
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
