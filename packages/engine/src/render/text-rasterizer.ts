import {
  type Size, type TextLayer, type TextStyle, type TextAlignment, type TextWordState, type RGBA,
  splitTextWords, DEFAULT_HIGHLIGHT_COLOR,
} from "@frontstage/core";

const css = (c: RGBA): string =>
  `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${c.a})`;

export interface WordBox {
  text: string;
  x: number;
  width: number;
}

/**
 * Single-line word positions (the rasterizer has no multi-line wrap to extend — see
 * task-2-report.md). Positions come from the FULL word list regardless of how many are actually
 * drawn, so revealed words never reflow as more become visible. Pure/canvas-free: widths come from
 * an injected measure fn (real `measureText` in `rasterize()`, a fake one in unit tests).
 */
export function layoutWordsLine(
  words: string[],
  measureWidth: (word: string) => number,
  spaceWidth: number,
  alignment: TextAlignment,
  cx: number,
): WordBox[] {
  const widths = words.map(measureWidth);
  const total = widths.reduce((a, b) => a + b, 0) + spaceWidth * Math.max(0, words.length - 1);
  const startX = alignment === "center" ? cx - total / 2 : alignment === "right" ? cx - total : cx;
  let x = startX;
  const out: WordBox[] = [];
  for (let i = 0; i < words.length; i++) {
    out.push({ text: words[i]!, x, width: widths[i]! });
    x += widths[i]! + spaceWidth;
  }
  return out;
}

/**
 * Cache key. Unchanged shape — `[text, style, renderSize]` — whenever `wordState` is absent (no
 * active preset, an entrance-only preset, or a wordTimings-alignment fallback), so the non-animated
 * path is byte-identical to pre-M11C. Extended only when a word state is actually driving the draw.
 */
export function textRasterCacheKey(layer: TextLayer, renderSize: Size): string {
  const ws = layer.wordState;
  if (!ws) return JSON.stringify([layer.text, layer.style, renderSize]);
  return JSON.stringify([
    layer.text, layer.style, renderSize,
    layer.preset, ws.visibleCount, ws.highlightIndex, ws.soloIndex, layer.highlightColor,
  ]);
}

export class TextRasterizer {
  private cache = new Map<string, VideoFrame>();

  rasterize(layer: TextLayer, renderSize: Size): VideoFrame {
    const key = textRasterCacheKey(layer, renderSize);
    const hit = this.cache.get(key);
    if (hit) return hit;

    const { width: W, height: H } = renderSize;
    const o = new OffscreenCanvas(W, H);
    const c = o.getContext("2d")!;
    const s = layer.style;
    // Always center the raster at canvas center; transform is applied at composite time.
    const cx = W / 2;
    const cy = H / 2;

    c.font = `${s.fontSize * s.fontScale}px ${s.fontName}`;
    c.textBaseline = "middle";

    const ws = layer.wordState;
    const isWordCycle = layer.preset === "wordCycle";
    const soloWord = ws && ws.soloIndex !== null ? (splitTextWords(layer.text)[ws.soloIndex] ?? "") : null;
    // wordCycle between two words' windows shows nothing (Swift: every word's activeRamp is 0).
    const blank = !!ws && isWordCycle && ws.soloIndex === null;
    const displayText = soloWord ?? layer.text;

    // background fill (behind text bounds)
    if (s.background.enabled) {
      const m = c.measureText(displayText);
      const tw = m.width;
      const th = s.fontSize * s.fontScale;
      const bx =
        s.alignment === "center" ? cx - tw / 2 : s.alignment === "right" ? cx - tw : cx;
      c.fillStyle = css(s.background.color);
      c.fillRect(bx - 8, cy - th / 2 - 4, tw + 16, th + 8);
    }

    // shadow
    if (s.shadow.enabled) {
      c.shadowColor = css(s.shadow.color);
      c.shadowBlur = s.shadow.blur;
      c.shadowOffsetX = s.shadow.offsetX;
      c.shadowOffsetY = s.shadow.offsetY;
    }

    if (blank) {
      // nothing to draw this frame
    } else if (!ws || soloWord !== null) {
      // Non-animated text, or wordCycle's solo word — single centered draw, byte-identical to the
      // pre-M11C path when ws is absent.
      this._drawSingle(c, s, displayText, cx, cy);
    } else {
      this._drawWords(c, layer, ws, cx, cy);
    }

    const vf = new VideoFrame(o.transferToImageBitmap(), { timestamp: 0 });
    this.cache.set(key, vf);
    return vf;
  }

  private _drawSingle(
    c: OffscreenCanvasRenderingContext2D,
    s: TextStyle,
    text: string,
    cx: number,
    cy: number,
  ): void {
    c.textAlign = s.alignment;
    if (s.border.enabled) {
      c.lineWidth = 2;
      c.strokeStyle = css(s.border.color);
      c.strokeText(text, cx, cy);
    }
    c.fillStyle = css(s.color);
    c.fillText(text, cx, cy);
  }

  /**
   * Draws every word up to `visibleCount` at its full-line position (typewriter/wordReveal/
   * wordSlide/wordPop/highlightPop/highlightBlock all land here). Entering words are drawn at full
   * opacity/scale — the smooth in-between (opacity ramp, wordSlide's dy, wordPop's overshoot) isn't
   * reproduced; see task-2-report.md for why (the plan's cache bound is ≤ wordCount+1 raster
   * variants per clip, never per frame — T1's exported wordActiveRamp/wordPopOvershoot stay unused
   * here for that reason). highlightPop/highlightBlock likewise use a hard on/off at highlightIndex
   * rather than activeRamp's continuous pulse.
   */
  private _drawWords(
    c: OffscreenCanvasRenderingContext2D,
    layer: TextLayer,
    ws: TextWordState,
    cx: number,
    cy: number,
  ): void {
    const s = layer.style;
    const words = splitTextWords(layer.text);
    const spaceWidth = c.measureText(" ").width;
    c.textAlign = "left";
    const boxes = layoutWordsLine(words, (w) => c.measureText(w).width, spaceWidth, s.alignment, cx);
    const highlightColor = layer.highlightColor ?? DEFAULT_HIGHLIGHT_COLOR;
    const fontSize = s.fontSize * s.fontScale;

    for (let i = 0; i < words.length; i++) {
      if (i >= ws.visibleCount) continue; // laid out but not yet revealed — no reflow when it appears
      const box = boxes[i]!;
      const highlighted = ws.highlightIndex === i;

      // Swift: drawWordBackground — rounded block behind the active word, base text color kept.
      if (layer.preset === "highlightBlock" && highlighted) {
        const m = c.measureText(box.text);
        const ascent = m.actualBoundingBoxAscent || fontSize * 0.8;
        const descent = m.actualBoundingBoxDescent || fontSize * 0.2;
        const padX = fontSize * 0.18;
        const padY = fontSize * 0.1;
        c.fillStyle = css(highlightColor);
        c.beginPath();
        c.roundRect(box.x - padX, cy - ascent - padY, box.width + padX * 2, ascent + descent + padY * 2, fontSize * 0.12);
        c.fill();
      }

      c.save();
      // Swift: highlightPop scales the active word to 1 + 0.15*on (on=1 here — see docstring above).
      if (layer.preset === "highlightPop" && highlighted) {
        const wcx = box.x + box.width / 2;
        c.translate(wcx, cy);
        c.scale(1.15, 1.15);
        c.translate(-wcx, -cy);
      }
      if (s.border.enabled) {
        c.lineWidth = 2;
        c.strokeStyle = css(s.border.color);
        c.strokeText(box.text, box.x, cy);
      }
      c.fillStyle = css(layer.preset === "highlightPop" && highlighted ? highlightColor : s.color);
      c.fillText(box.text, box.x, cy);
      c.restore();
    }
  }

  dispose(): void {
    for (const f of this.cache.values()) f.close();
    this.cache.clear();
  }
}
