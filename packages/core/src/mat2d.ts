import type { Transform } from "./transform.js";

export interface Size {
  width: number;
  height: number;
}

export interface Mat2d {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export function mat2dIdentity(): Mat2d {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

/** The transform that applies `m` first, then `n` (CoreGraphics `m.concatenating(n)`). */
export function mat2dMultiply(m: Mat2d, n: Mat2d): Mat2d {
  return {
    a: n.a * m.a + n.c * m.b,
    b: n.b * m.a + n.d * m.b,
    c: n.a * m.c + n.c * m.d,
    d: n.b * m.c + n.d * m.d,
    e: n.a * m.e + n.c * m.f + n.e,
    f: n.b * m.e + n.d * m.f + n.f,
  };
}

/** Inverse of an affine Mat2d, or null if degenerate (zero-area — e.g. width/height 0). */
export function mat2dInvert(m: Mat2d): Mat2d | null {
  const det = m.a * m.d - m.b * m.c;
  if (det === 0) return null;
  return {
    a: m.d / det,
    b: -m.b / det,
    c: -m.c / det,
    d: m.a / det,
    e: (m.c * m.f - m.d * m.e) / det,
    f: (m.b * m.e - m.a * m.f) / det,
  };
}

/** Applies `m` to point `p` (matches the CG convention: x' = a*x + c*y + e, y' = b*x + d*y + f). */
export function mat2dApply(m: Mat2d, p: { x: number; y: number }): { x: number; y: number } {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

const scale = (sx: number, sy: number): Mat2d => ({ a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 });
const translate = (tx: number, ty: number): Mat2d => ({ a: 1, b: 0, c: 0, d: 1, e: tx, f: ty });
const rotate = (rad: number): Mat2d => ({ a: Math.cos(rad), b: Math.sin(rad), c: -Math.sin(rad), d: Math.cos(rad), e: 0, f: 0 });

/** Port of Swift CompositionBuilder.affineTransform(for:natSize:renderSize:). */
export function affineTransform(t: Transform, natSize: Size, renderSize: Size): Mat2d {
  const tlx = t.centerX - t.width / 2;
  const tly = t.centerY - t.height / 2;
  const sx = (renderSize.width / natSize.width) * t.width * (t.flipHorizontal ? -1 : 1);
  const sy = (renderSize.height / natSize.height) * t.height * (t.flipVertical ? -1 : 1);
  const tx = (t.flipHorizontal ? tlx + t.width : tlx) * renderSize.width;
  const ty = (t.flipVertical ? tly + t.height : tly) * renderSize.height;
  const placed = mat2dMultiply(scale(sx, sy), translate(tx, ty));
  if (t.rotation === 0) return placed;
  const cx = t.centerX * renderSize.width;
  const cy = t.centerY * renderSize.height;
  let r = mat2dMultiply(placed, translate(-cx, -cy));
  r = mat2dMultiply(r, rotate((t.rotation * Math.PI) / 180));
  r = mat2dMultiply(r, translate(cx, cy));
  return r;
}
