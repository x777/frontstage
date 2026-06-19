import { lerpNumber } from "./keyframe.js";

export interface Transform {
  centerX: number;
  centerY: number;
  width: number;
  height: number;
  rotation: number; // degrees, positive = clockwise
  flipHorizontal: boolean;
  flipVertical: boolean;
}

export interface Crop {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function defaultTransform(): Transform {
  return { centerX: 0.5, centerY: 0.5, width: 1, height: 1, rotation: 0, flipHorizontal: false, flipVertical: false };
}

export function defaultCrop(): Crop {
  return { left: 0, top: 0, right: 0, bottom: 0 };
}

export function transformTopLeft(t: Transform): { x: number; y: number } {
  return { x: t.centerX - t.width / 2, y: t.centerY - t.height / 2 };
}

export function cropIsIdentity(c: Crop): boolean {
  return c.left === 0 && c.top === 0 && c.right === 0 && c.bottom === 0;
}

export function cropVisibleWidthFraction(c: Crop): number {
  return Math.max(0, 1 - c.left - c.right);
}

export function cropVisibleHeightFraction(c: Crop): number {
  return Math.max(0, 1 - c.top - c.bottom);
}

export function lerpCrop(a: Crop, b: Crop, t: number): Crop {
  return {
    left: lerpNumber(a.left, b.left, t),
    top: lerpNumber(a.top, b.top, t),
    right: lerpNumber(a.right, b.right, t),
    bottom: lerpNumber(a.bottom, b.bottom, t),
  };
}

export function snapToBoundary(value: number, threshold: number): number {
  if (Math.abs(value) < threshold) return 0;
  if (Math.abs(value - 1) < threshold) return 1;
  return value;
}

export function snapToCanvasEdges(t: Transform, threshold: number): Transform {
  let { centerX, centerY } = t;
  const tl = { x: centerX - t.width / 2, y: centerY - t.height / 2 };
  const snappedLeft = snapToBoundary(tl.x, threshold);
  const snappedRight = snapToBoundary(tl.x + t.width, threshold);
  if (snappedLeft !== tl.x) centerX -= tl.x - snappedLeft;
  else if (snappedRight !== tl.x + t.width) centerX -= tl.x + t.width - snappedRight;

  const tl2y = centerY - t.height / 2;
  const snappedTop = snapToBoundary(tl2y, threshold);
  const snappedBottom = snapToBoundary(tl2y + t.height, threshold);
  if (snappedTop !== tl2y) centerY -= tl2y - snappedTop;
  else if (snappedBottom !== tl2y + t.height) centerY -= tl2y + t.height - snappedBottom;

  return { ...t, centerX, centerY };
}
