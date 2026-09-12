import type { Clip } from "./clip.js";
import type { BlendMode } from "./color/blend-mode.js";
import type { RGB } from "./color/color-math.js";
import { defaultTextStyle, TEXT_AXIS_SCALE_RANGE, type RGBA, type TextStyle } from "./text-style.js";

/** Palmier `TextFillMode`. `color` is stored as a missing `textFillMode`. */
export type TextFillMode = "color" | "footage" | "inverted";

export const TEXT_FILL_MODES: readonly TextFillMode[] = ["color", "footage", "inverted"];

/** Palmier `TextFillMode.defaultFootageMatteColor`. */
export const DEFAULT_FOOTAGE_MATTE_COLOR: RGBA = { r: 0, g: 0, b: 0, a: 1 };

export function parseTextFillMode(raw: string | undefined): TextFillMode | undefined {
  if (raw === undefined) return undefined;
  return TEXT_FILL_MODES.includes(raw as TextFillMode) ? (raw as TextFillMode) : undefined;
}

/**
 * Palmier `Clip.setTextFillMode`. `color` clears the field; entering `footage` without an
 * explicit color sets the black matte.
 */
export function applyTextFillMode(
  clip: Clip,
  mode: TextFillMode,
  footageMatteColor?: RGBA,
): Clip {
  let textStyle = clip.textStyle;
  if (mode === "footage" && clip.textFillMode !== "footage") {
    textStyle = { ...(textStyle ?? defaultTextStyle()), color: footageMatteColor ?? DEFAULT_FOOTAGE_MATTE_COLOR };
  }
  return { ...clip, textStyle, textFillMode: mode === "color" ? undefined : mode };
}

export function clampTextAxisScale(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(TEXT_AXIS_SCALE_RANGE.max, Math.max(TEXT_AXIS_SCALE_RANGE.min, value));
}

/** How the rasterizer / compositor should treat a text layer (Palmier fillMode + scale + blur). */
export interface TextRasterAppearance {
  fillMode: TextFillMode;
  fill: RGBA;
  /** Palmier footage matte (`style.color`); ignored unless `stencil`. */
  matte: RGBA;
  drawShadow: boolean;
  drawBorder: boolean;
  drawBackground: boolean;
  widthScale: number;
  heightScale: number;
  /** Gaussian blur in output pixels (style.blur is 1080p-canvas pixels). */
  blurPx: number;
  blendMode?: BlendMode;
  stencil: boolean;
}

export function textRasterAppearance(
  style: TextStyle,
  fillMode: TextFillMode | undefined,
  renderHeight: number,
): TextRasterAppearance {
  const mode: TextFillMode = fillMode ?? "color";
  const inverted = mode === "inverted";
  const footage = mode === "footage";
  const chrome = !inverted && !footage;
  const height = renderHeight > 0 && Number.isFinite(renderHeight) ? renderHeight : 1080;
  return {
    fillMode: mode,
    fill: inverted || footage ? { r: 1, g: 1, b: 1, a: 1 } : style.color,
    matte: style.color,
    drawShadow: chrome && style.shadow.enabled,
    drawBorder: chrome && style.border.enabled,
    drawBackground: chrome && style.background.enabled,
    widthScale: clampTextAxisScale(style.widthScale ?? 1),
    heightScale: clampTextAxisScale(style.heightScale ?? 1),
    blurPx: Math.max(0, (style.blur ?? 0) * (height / 1080)),
    blendMode: inverted ? "difference" : undefined,
    stencil: footage,
  };
}

/**
 * Palmier `CIBlendWithMask`: white mask keeps `dest` (layers below through the glyphs);
 * black mask shows `matte` composited over `dest`. `opacity` dissolves toward `dest`.
 */
export function applyFootageStencil(dest: RGB, maskCoverage: number, matte: RGBA, opacity = 1): RGB {
  const m = Math.min(1, Math.max(0, maskCoverage));
  const ma = Math.min(1, Math.max(0, matte.a));
  const over = {
    r: matte.r * ma + dest.r * (1 - ma),
    g: matte.g * ma + dest.g * (1 - ma),
    b: matte.b * ma + dest.b * (1 - ma),
  };
  const stenciled = {
    r: over.r * (1 - m) + dest.r * m,
    g: over.g * (1 - m) + dest.g * m,
    b: over.b * (1 - m) + dest.b * m,
  };
  const o = Math.min(1, Math.max(0, opacity));
  if (o >= 1) return stenciled;
  return {
    r: dest.r * (1 - o) + stenciled.r * o,
    g: dest.g * (1 - o) + stenciled.g * o,
    b: dest.b * (1 - o) + stenciled.b * o,
  };
}
