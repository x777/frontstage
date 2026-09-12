import type { CanvasOverlaySelection } from "@frontstage/core";
import {
  CANVAS_FORMAT_ASPECT,
  canvasFormatContentRect,
  canvasGridLinePositions,
  canvasGuideSafeZoneInset,
  canvasOutsideRects,
} from "@frontstage/core";
import { theme } from "../theme/theme.js";
import type { CanvasRect } from "./TransformOverlay.js";

interface CanvasViewingOverlayProps {
  selection: CanvasOverlaySelection;
  canvasRect: CanvasRect;
}

/** Palmier `AppTheme.Spacing.lg` — center-crosshair arm. Mirrors `--spacing-lg`. */
const CENTER_ARM = 14;

function GuideStroke({ d, opacity }: { d: string; opacity: string }) {
  return (
    <>
      <path
        d={d}
        fill="none"
        stroke={theme.bg.base}
        strokeOpacity={theme.opacity.strong}
        strokeWidth={theme.borderWidth.thick}
      />
      <path
        d={d}
        fill="none"
        stroke={theme.text.primary}
        strokeOpacity={opacity}
        strokeWidth={theme.borderWidth.hairline}
      />
    </>
  );
}

export function CanvasViewingOverlay({ selection, canvasRect }: CanvasViewingOverlayProps) {
  const { width, height } = canvasRect;
  if (!(width > 0) || !(height > 0)) return null;

  const paths: { d: string; opacity: string }[] = [];
  const fills: { x: number; y: number; width: number; height: number }[] = [];

  if (selection.format) {
    const content = canvasFormatContentRect(CANVAS_FORMAT_ASPECT[selection.format], { width, height });
    for (const r of canvasOutsideRects(content, { width, height })) fills.push(r);
    paths.push({
      d: `M${content.x} ${content.y}h${content.width}v${content.height}h${-content.width}z`,
      opacity: theme.opacity.medium,
    });
  }

  if (selection.grid) {
    const segs: string[] = [];
    for (const p of canvasGridLinePositions(selection.grid)) {
      segs.push(`M${width * p} 0 V${height}`);
      segs.push(`M0 ${height * p} H${width}`);
    }
    paths.push({ d: segs.join(" "), opacity: theme.opacity.prominent });
  }

  for (const guide of ["actionSafe", "titleSafe", "center"] as const) {
    if (!selection.guides.has(guide)) continue;
    if (guide === "center") {
      const cx = width / 2;
      const cy = height / 2;
      paths.push({
        d: `M${cx - CENTER_ARM} ${cy} H${cx + CENTER_ARM} M${cx} ${cy - CENTER_ARM} V${cy + CENTER_ARM}`,
        opacity: theme.opacity.prominent,
      });
    } else {
      const inset = canvasGuideSafeZoneInset(guide)!;
      const dx = width * inset;
      const dy = height * inset;
      paths.push({
        d: `M${dx} ${dy}h${width - dx * 2}v${height - dy * 2}h${-(width - dx * 2)}z`,
        opacity: guide === "titleSafe" ? theme.opacity.prominent : theme.opacity.medium,
      });
    }
  }

  if (fills.length === 0 && paths.length === 0) return null;

  return (
    <svg
      data-testid="canvas-viewing-overlay"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{
        position: "absolute",
        left: canvasRect.left,
        top: canvasRect.top,
        pointerEvents: "none",
        overflow: "visible",
      }}
    >
      {fills.map((r, i) => (
        <rect
          key={`fmt-${i}`}
          x={r.x}
          y={r.y}
          width={r.width}
          height={r.height}
          fill={theme.bg.previewLetterbox}
          fillOpacity={theme.opacity.strong}
        />
      ))}
      {paths.map((p, i) => (
        <GuideStroke key={`g-${i}`} d={p.d} opacity={p.opacity} />
      ))}
    </svg>
  );
}
