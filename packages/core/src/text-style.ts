/** NSAttributedString's percent-of-font-size stroke convention (negative = fill+stroke), ported from Swift's TextStyle.glyphBorderStrokeWidth. */
export const GLYPH_BORDER_STROKE_WIDTH = -4;

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export type TextAlignment = "left" | "center" | "right";

export interface Shadow {
  enabled: boolean;
  color: RGBA;
  offsetX: number;
  offsetY: number;
  blur: number;
}

export interface Fill {
  enabled: boolean;
  color: RGBA;
}

export interface TextStyle {
  fontName: string;
  fontSize: number;
  fontScale: number;
  color: RGBA;
  alignment: TextAlignment;
  shadow: Shadow;
  background: Fill;
  border: Fill;
}

export function defaultTextStyle(): TextStyle {
  return {
    fontName: "Helvetica-Bold",
    fontSize: 96,
    fontScale: 1,
    color: { r: 1, g: 1, b: 1, a: 1 },
    alignment: "center",
    shadow: { enabled: true, color: { r: 0, g: 0, b: 0, a: 0.6 }, offsetX: 0, offsetY: -2, blur: 6 },
    background: { enabled: false, color: { r: 0, g: 0, b: 0, a: 0.6 } },
    border: { enabled: false, color: { r: 0, g: 0, b: 0, a: 1 } },
  };
}

export function rgbaFromHex(hex: string): RGBA | null {
  let s = hex.trim();
  if (s.startsWith("#")) s = s.slice(1);
  const component = (start: number, len: number): number | null => {
    const slice = s.slice(start, start + len);
    const byteStr = len === 1 ? slice + slice : slice;
    if (!/^[0-9a-fA-F]+$/.test(byteStr)) return null;
    return parseInt(byteStr, 16) / 255;
  };
  if (s.length === 3) {
    const r = component(0, 1), g = component(1, 1), b = component(2, 1);
    return r === null || g === null || b === null ? null : { r, g, b, a: 1 };
  }
  if (s.length === 6) {
    const r = component(0, 2), g = component(2, 2), b = component(4, 2);
    return r === null || g === null || b === null ? null : { r, g, b, a: 1 };
  }
  if (s.length === 8) {
    const r = component(0, 2), g = component(2, 2), b = component(4, 2), a = component(6, 2);
    return r === null || g === null || b === null || a === null ? null : { r, g, b, a };
  }
  return null;
}
