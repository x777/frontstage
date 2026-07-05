import { heuristicCaptionWidthFrac } from "@frontstage/core";

export interface CaptionMeasureStyle {
  fontName: string;
  fontSize: number;
}

// Reused across calls — buildCaptionPhrases' line-fitting loop calls this per candidate split.
let measureCtx: CanvasRenderingContext2D | null | undefined;

function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (measureCtx === undefined) {
    measureCtx = document.createElement("canvas").getContext("2d");
  }
  return measureCtx;
}

/**
 * Rendered width of `text` at `style`'s font, as a fraction of `canvasWidth` — the unit
 * ToolContext.transcription.measureText and buildCaptionPhrases' `measure` both expect. Canvas2D
 * measureText when a 2D context is available; jsdom's canvas has no backend (getContext returns
 * null), so tests fall through to the SAME heuristic add_captions uses without a wired measureText
 * (@frontstage/core's heuristicCaptionWidthFrac — the one shared constant, see caption-tools.ts).
 */
export function measureCaptionWidthFrac(text: string, style: CaptionMeasureStyle, canvasWidth: number): number {
  const ctx = getMeasureCtx();
  if (ctx && canvasWidth > 0) {
    ctx.font = `${style.fontSize}px ${style.fontName}`;
    return ctx.measureText(text).width / canvasWidth;
  }
  return heuristicCaptionWidthFrac(text, style.fontSize, canvasWidth);
}
