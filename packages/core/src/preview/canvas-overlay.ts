/** Palmier `CanvasGridOverlay` — 2×2 through 5×5. */
export type CanvasGridOverlay = 2 | 3 | 4 | 5;
export const CANVAS_GRID_PRESETS: readonly CanvasGridOverlay[] = [2, 3, 4, 5];

export function canvasGridLinePositions(grid: CanvasGridOverlay): number[] {
  const out: number[] = [];
  for (let i = 1; i < grid; i++) out.push(i / grid);
  return out;
}

/** Palmier `CanvasGuideOverlay`. */
export type CanvasGuideKind = "actionSafe" | "titleSafe" | "center";
export const CANVAS_GUIDE_KINDS: readonly CanvasGuideKind[] = ["actionSafe", "titleSafe", "center"];

export function canvasGuideSafeZoneInset(guide: CanvasGuideKind): number | undefined {
  switch (guide) {
    case "actionSafe":
      return 0.035;
    case "titleSafe":
      return 0.05;
    case "center":
      return undefined;
  }
}

/** Palmier `CanvasFormatOverlay`. */
export type CanvasFormatKind = "scope" | "wide" | "square" | "portrait";
export const CANVAS_FORMAT_KINDS: readonly CanvasFormatKind[] = ["scope", "wide", "square", "portrait"];
export const CANVAS_FORMAT_ASPECT: Record<CanvasFormatKind, number> = {
  scope: 2.39,
  wide: 1.85,
  square: 1,
  portrait: 9 / 16,
};
export const CANVAS_FORMAT_LABEL: Record<CanvasFormatKind, string> = {
  scope: "Scope (2.39:1)",
  wide: "Wide (1.85:1)",
  square: "Square (1:1)",
  portrait: "Portrait (9:16)",
};

export interface OverlayRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OverlaySize {
  width: number;
  height: number;
}

/** Palmier `CanvasOverlayGeometry.contentRect`. */
export function canvasFormatContentRect(aspectRatio: number, size: OverlaySize): OverlayRect {
  if (!(aspectRatio > 0) || !(size.width > 0) || !(size.height > 0)) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const canvasAspect = size.width / size.height;
  if (canvasAspect > aspectRatio) {
    const width = size.height * aspectRatio;
    return { x: (size.width - width) / 2, y: 0, width, height: size.height };
  }
  const height = size.width / aspectRatio;
  return { x: 0, y: (size.height - height) / 2, width: size.width, height };
}

/** Palmier `CanvasOverlayGeometry.outsideRects`. */
export function canvasOutsideRects(content: OverlayRect, size: OverlaySize): OverlayRect[] {
  return [
    { x: 0, y: 0, width: size.width, height: content.y },
    {
      x: 0,
      y: content.y + content.height,
      width: size.width,
      height: size.height - (content.y + content.height),
    },
    { x: 0, y: content.y, width: content.x, height: content.height },
    {
      x: content.x + content.width,
      y: content.y,
      width: size.width - (content.x + content.width),
      height: content.height,
    },
  ].filter((r) => r.width > 0 && r.height > 0);
}

/** Palmier `CanvasOverlaySelection`. */
export interface CanvasOverlaySelection {
  grid?: CanvasGridOverlay;
  guides: ReadonlySet<CanvasGuideKind>;
  format?: CanvasFormatKind;
}

export function emptyCanvasOverlaySelection(): CanvasOverlaySelection {
  return { guides: new Set() };
}

export function canvasOverlayIsEmpty(selection: CanvasOverlaySelection): boolean {
  return selection.grid === undefined && selection.guides.size === 0 && selection.format === undefined;
}

export function clearCanvasOverlaySelection(): CanvasOverlaySelection {
  return emptyCanvasOverlaySelection();
}
