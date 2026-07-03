// Ported from Swift Models/VideoLayout.swift (10 presets) + EditorViewModel+Layout.swift
// (layoutPlacement fill/fit math) + ToolExecutor+Layout.swift's `layoutAnchors` map. Pure geometry —
// no clip/asset lookups; callers resolve source pixel dimensions and canvas size themselves.

import { defaultCrop } from "../transform.js";
import type { Crop, Transform } from "../transform.js";

export interface LayoutRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutSlot {
  id: string;
  rect: LayoutRect;
  z: number;
}

export type LayoutFit = "fill" | "fit";

// Enum declaration order in Swift's CaseIterable VideoLayout — used verbatim in error messages.
export const LAYOUT_IDS = [
  "full",
  "side_by_side",
  "top_bottom",
  "pip_bottom_right",
  "pip_bottom_left",
  "pip_top_right",
  "pip_top_left",
  "grid_2x2",
  "main_sidebar",
  "three_up",
] as const;

const PIP_INSET = 0.28;
const PIP_MARGIN = 0.035;
const THIRD = 1 / 3;

function pipSlots(insetX: number, insetY: number): LayoutSlot[] {
  return [
    { id: "main", rect: { x: 0, y: 0, w: 1, h: 1 }, z: 0 },
    { id: "inset", rect: { x: insetX, y: insetY, w: PIP_INSET, h: PIP_INSET }, z: 1 },
  ];
}

export const videoLayouts: Record<string, LayoutSlot[]> = {
  full: [{ id: "main", rect: { x: 0, y: 0, w: 1, h: 1 }, z: 0 }],

  side_by_side: [
    { id: "left", rect: { x: 0, y: 0, w: 0.5, h: 1 }, z: 0 },
    { id: "right", rect: { x: 0.5, y: 0, w: 0.5, h: 1 }, z: 0 },
  ],

  top_bottom: [
    { id: "top", rect: { x: 0, y: 0, w: 1, h: 0.5 }, z: 0 },
    { id: "bottom", rect: { x: 0, y: 0.5, w: 1, h: 0.5 }, z: 0 },
  ],

  pip_bottom_right: pipSlots(1 - PIP_MARGIN - PIP_INSET, 1 - PIP_MARGIN - PIP_INSET),
  pip_bottom_left: pipSlots(PIP_MARGIN, 1 - PIP_MARGIN - PIP_INSET),
  pip_top_right: pipSlots(1 - PIP_MARGIN - PIP_INSET, PIP_MARGIN),
  pip_top_left: pipSlots(PIP_MARGIN, PIP_MARGIN),

  grid_2x2: [
    { id: "top_left", rect: { x: 0, y: 0, w: 0.5, h: 0.5 }, z: 0 },
    { id: "top_right", rect: { x: 0.5, y: 0, w: 0.5, h: 0.5 }, z: 0 },
    { id: "bottom_left", rect: { x: 0, y: 0.5, w: 0.5, h: 0.5 }, z: 0 },
    { id: "bottom_right", rect: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, z: 0 },
  ],

  main_sidebar: [
    { id: "main", rect: { x: 0, y: 0, w: 0.7, h: 1 }, z: 0 },
    { id: "sidebar", rect: { x: 0.7, y: 0, w: 0.3, h: 1 }, z: 0 },
  ],

  three_up: [
    { id: "left", rect: { x: 0, y: 0, w: THIRD, h: 1 }, z: 0 },
    { id: "center", rect: { x: THIRD, y: 0, w: THIRD, h: 1 }, z: 0 },
    { id: "right", rect: { x: THIRD * 2, y: 0, w: THIRD, h: 1 }, z: 0 },
  ],
};

// Named anchors — ToolExecutor+Layout.swift's `layoutAnchors`, verbatim.
export const layoutAnchors: Record<string, { x: number; y: number }> = {
  center: { x: 0.5, y: 0.5 },
  top: { x: 0.5, y: 0 },
  bottom: { x: 0.5, y: 1 },
  left: { x: 0, y: 0.5 },
  right: { x: 1, y: 0.5 },
  top_left: { x: 0, y: 0 },
  top_right: { x: 1, y: 0 },
  bottom_left: { x: 0, y: 1 },
  bottom_right: { x: 1, y: 1 },
};

function transformFromTopLeft(x: number, y: number, w: number, h: number): Transform {
  return { centerX: x + w / 2, centerY: y + h / 2, width: w, height: h, rotation: 0, flipHorizontal: false, flipVertical: false };
}

// Port of EditorViewModel.cropFittingAspect: anchor-biased crop of the source to a target pixel aspect.
function cropFittingAspect(sourceW: number, sourceH: number, target: number, anchorX: number, anchorY: number): Crop {
  if (sourceW <= 0 || sourceH <= 0 || target <= 0) return defaultCrop();
  const sourceAspect = sourceW / sourceH;
  if (Math.abs(sourceAspect - target) < 0.0001) return defaultCrop();
  const ax = Math.min(1, Math.max(0, anchorX));
  const ay = Math.min(1, Math.max(0, anchorY));
  if (sourceAspect > target) {
    const total = 1 - target / sourceAspect;
    const left = total * ax;
    return { left, top: 0, right: total - left, bottom: 0 };
  }
  const total = 1 - sourceAspect / target;
  const top = total * ay;
  return { left: 0, top, right: 0, bottom: total - top };
}

/**
 * Port of EditorViewModel+Layout.swift's layoutPlacement.
 * fill: crop the source to the slot's pixel aspect (anchor-biased), then cover-scale/position into the slot rect.
 * fit: no crop — letterbox the whole source inside the slot, anchored within the leftover slack.
 */
export function layoutPlacement(
  sourceW: number,
  sourceH: number,
  slot: LayoutSlot,
  canvasW: number,
  canvasH: number,
  fit: LayoutFit,
  anchorX: number,
  anchorY: number,
): { transform: Transform; crop: Crop } {
  const rect = slot.rect;
  const canvasAspect = canvasW / Math.max(1, canvasH);
  const slotPixelAspect = rect.h > 0 ? (rect.w / rect.h) * canvasAspect : canvasAspect;

  if (fit === "fill") {
    const crop = cropFittingAspect(sourceW, sourceH, slotPixelAspect, anchorX, anchorY);
    const vw = Math.max(0, 1 - crop.left - crop.right);
    const vh = Math.max(0, 1 - crop.top - crop.bottom);
    if (vw <= 0 || vh <= 0) {
      return { transform: transformFromTopLeft(rect.x, rect.y, rect.w, rect.h), crop };
    }
    const w = rect.w / vw;
    const h = rect.h / vh;
    const x = rect.x - crop.left * w;
    const y = rect.y - crop.top * h;
    return { transform: transformFromTopLeft(x, y, w, h), crop };
  }

  // fit
  if (sourceW <= 0 || sourceH <= 0 || canvasW <= 0 || canvasH <= 0) {
    return { transform: transformFromTopLeft(rect.x, rect.y, rect.w, rect.h), crop: defaultCrop() };
  }
  const rel = sourceW / sourceH / canvasAspect;
  let drawW = rect.w;
  let drawH = rect.h;
  if (rel * rect.h <= rect.w) {
    drawH = rect.h;
    drawW = rel * rect.h;
  } else {
    drawW = rect.w;
    drawH = rect.w / rel;
  }
  const ax = Math.min(1, Math.max(0, anchorX));
  const ay = Math.min(1, Math.max(0, anchorY));
  const x = rect.x + (rect.w - drawW) * ax;
  const y = rect.y + (rect.h - drawH) * ay;
  return { transform: transformFromTopLeft(x, y, drawW, drawH), crop: defaultCrop() };
}
