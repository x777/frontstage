import { useRef, useEffect, useState } from "react";
import type { HueCurves, CurvePoint } from "@frontstage/core";
import {
  hueDisplayPoints,
  evalHuePolyline,
  nearestPoint,
  addPoint,
  movePoint,
  removePoint,
} from "@frontstage/core";
import { theme } from "../../theme/theme.js";

// Canvas colors mirror their CSS tokens (ctx can't consume CSS vars).
const GRID_COLOR = "rgba(255,255,255,0.12)";        // matches --color-adjust-curve-grid
const BORDER_COLOR = "rgba(255,255,255,0.16)";       // matches --color-adjust-curve-border
const NEUTRAL_LINE_COLOR = "rgba(255,255,255,0.28)"; // matches --color-adjust-huecurve-neutral
const CURVE_HUE = "#ffffff";                          // matches --color-adjust-huecurve-hue
const CURVE_SAT = "#88ff88";                          // matches --color-adjust-huecurve-sat
const CURVE_LUM = "#8899ff";                          // matches --color-adjust-huecurve-lum

// 7 hue stops spanning R→Y→G→C→B→M→R across the full spectrum width.
const SPECTRUM_STOPS: Array<{ offset: number; color: string }> = [
  { offset: 0,     color: "hsl(0,72%,34%)" },
  { offset: 1 / 6, color: "hsl(60,72%,38%)" },
  { offset: 2 / 6, color: "hsl(120,68%,32%)" },
  { offset: 3 / 6, color: "hsl(180,68%,32%)" },
  { offset: 4 / 6, color: "hsl(240,64%,38%)" },
  { offset: 5 / 6, color: "hsl(300,64%,36%)" },
  { offset: 1,     color: "hsl(360,72%,34%)" },
];

const DOT_RADIUS = 4.5;  // matches --size-curve-dot (9px diameter)
const HIT_RADIUS = 0.08; // normalized [0,1] hit threshold
const CANVAS_SIZE = 180; // matches --size-curve-canvas
const POLYLINE_STEPS = 64;

type HueChannel = "hueVsHue" | "hueVsSat" | "hueVsLum";

const CHANNEL_LABELS: Record<HueChannel, string> = {
  hueVsHue: "Hue",
  hueVsSat: "Sat",
  hueVsLum: "Luma",
};

function channelColor(ch: HueChannel): string {
  if (ch === "hueVsSat") return CURVE_SAT;
  if (ch === "hueVsLum") return CURVE_LUM;
  return CURVE_HUE;
}

function getChannelPts(curves: HueCurves, ch: HueChannel): CurvePoint[] {
  return curves[ch];
}

function withChannelPts(curves: HueCurves, ch: HueChannel, pts: CurvePoint[]): HueCurves {
  return { ...curves, [ch]: pts };
}

function canvasToCurve(cx: number, cy: number, w: number, h: number): [number, number] {
  return [cx / w, 1 - cy / h]; // y-inverted: canvas y-down, curve y-up
}

export interface HueCurveEditorProps {
  curves: HueCurves;
  channel: HueChannel;
  onChannel: (c: HueChannel) => void;
  onChange: (curves: HueCurves) => void;
  onCommit: () => void;
  hueHistogram?: number[];
}

export function HueCurveEditor({
  curves,
  channel,
  onChannel,
  onChange,
  onCommit,
  hueHistogram,
}: HueCurveEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef<{ index: number } | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(-1);

  const stored = getChannelPts(curves, channel);
  const dispPts = hueDisplayPoints(stored);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return; // jsdom guard — no drawing, interactive wrapper still works

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Rainbow spectrum background gradient
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    for (const stop of SPECTRUM_STOPS) grad.addColorStop(stop.offset, stop.color);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Hue histogram backdrop (saturation-weighted, monochrome)
    if (hueHistogram && hueHistogram.length > 0) {
      const bins = hueHistogram.length;
      const max = Math.max(...hueHistogram, 1);
      const bw = W / bins;
      ctx.fillStyle = "rgba(0,0,0,0.50)";
      for (let i = 0; i < bins; i++) {
        const barH = ((hueHistogram[i] ?? 0) / max) * H;
        ctx.fillRect((i / bins) * W, H - barH, bw, barH);
      }
    }

    // Border
    ctx.strokeStyle = BORDER_COLOR;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

    // 6 vertical grid lines at i/6 (hue sector boundaries)
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 0.5;
    for (let i = 1; i < 6; i++) {
      const x = (i / 6) * W;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }

    // Dashed neutral midline at y=0.5
    ctx.strokeStyle = NEUTRAL_LINE_COLOR;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Active channel curve polyline (cyclic)
    const polyline = evalHuePolyline(dispPts, POLYLINE_STEPS);
    ctx.strokeStyle = channelColor(channel);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    polyline.forEach((p, i) => {
      const px = p.x * W;
      const py = (1 - p.y) * H; // y-inversion
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.stroke();

    // Point dots
    ctx.fillStyle = channelColor(channel);
    dispPts.forEach((p) => {
      ctx.beginPath();
      ctx.arc(p.x * W, (1 - p.y) * H, DOT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    });
  }, [curves, channel, dispPts, hueHistogram]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = e.currentTarget;
    canvas.setPointerCapture(e.pointerId);
    const rect = canvas.getBoundingClientRect();
    const [x, y] = canvasToCurve(
      e.clientX - rect.left, e.clientY - rect.top,
      canvas.width, canvas.height,
    );
    const editable = hueDisplayPoints(stored);
    const idx = nearestPoint(editable, x, y, HIT_RADIUS);
    if (idx >= 0) {
      dragging.current = { index: idx };
      setSelectedIdx(idx);
    } else {
      const { points: newPts, index } = addPoint(editable, x, y);
      dragging.current = { index };
      setSelectedIdx(index);
      onChange(withChannelPts(curves, channel, newPts));
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragging.current) return;
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const [x, y] = canvasToCurve(
      e.clientX - rect.left, e.clientY - rect.top,
      canvas.width, canvas.height,
    );
    const editable = hueDisplayPoints(stored);
    const newPts = movePoint(editable, dragging.current.index, x, y);
    onChange(withChannelPts(curves, channel, newPts));
  };

  const onPointerUp = () => {
    if (!dragging.current) return;
    dragging.current = null;
    onCommit();
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = e.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const [x, y] = canvasToCurve(
      e.clientX - rect.left, e.clientY - rect.top,
      canvas.width, canvas.height,
    );
    const editable = hueDisplayPoints(stored);
    const idx = nearestPoint(editable, x, y, HIT_RADIUS);
    if (idx < 0) return;
    const newPts = removePoint(editable, idx);
    if (newPts === editable) return; // endpoint or min-2, unchanged
    onChange(withChannelPts(curves, channel, newPts));
    onCommit();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (selectedIdx < 0) return;
    const editable = hueDisplayPoints(stored);
    const p = editable[selectedIdx];
    if (!p) return;
    const STEP = 0.02;
    let nx = p.x, ny = p.y;
    if      (e.key === "ArrowRight") nx += STEP;
    else if (e.key === "ArrowLeft")  nx -= STEP;
    else if (e.key === "ArrowUp")    ny += STEP;
    else if (e.key === "ArrowDown")  ny -= STEP;
    else return;
    e.preventDefault();
    const newPts = movePoint(editable, selectedIdx, nx, ny);
    onChange(withChannelPts(curves, channel, newPts));
    onCommit();
  };

  // Testable path: adds a point at (0.4, 0.75) on the active channel
  // so jsdom tests can trigger an edit without canvas pointer geometry.
  const handleAddTestPoint = () => {
    const editable = hueDisplayPoints(stored);
    const { points: newPts, index } = addPoint(editable, 0.4, 0.75);
    setSelectedIdx(index);
    onChange(withChannelPts(curves, channel, newPts));
    onCommit();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing.xxs }}>
      {/* Channel picker: Hue / Sat / Luma */}
      <div style={{ display: "flex", gap: theme.spacing.xxs }}>
        {(["hueVsHue", "hueVsSat", "hueVsLum"] as HueChannel[]).map((ch) => (
          <button
            key={ch}
            data-testid={`hue-curve-channel-${ch}`}
            aria-pressed={channel === ch}
            onClick={() => onChannel(ch)}
            style={{
              flex: 1,
              background: channel === ch ? theme.accent.primary : theme.bg.raised,
              color: channel === ch ? theme.bg.base : theme.text.secondary,
              border: `${theme.borderWidth.hairline} solid ${theme.border.primary}`,
              borderRadius: theme.radius.xs,
              padding: `${theme.spacing.xxs} 0`,
              fontSize: theme.fontSize.xxs,
              fontWeight: theme.fontWeight.semibold,
              cursor: "pointer",
            }}
          >
            {CHANNEL_LABELS[ch]}
          </button>
        ))}
      </div>
      {/* Canvas */}
      <canvas
        ref={canvasRef}
        width={CANVAS_SIZE}
        height={CANVAS_SIZE}
        tabIndex={0}
        data-testid="hue-curve-canvas"
        style={{
          width: "100%",
          height: theme.size.curveCanvas,
          display: "block",
          cursor: "crosshair",
          outline: "none",
          borderRadius: theme.radius.xs,
          background: theme.bg.base,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
      />
      {/* Testable edit affordance — button path for tests (jsdom has no canvas geometry) */}
      <button
        data-testid="hue-curve-add-point"
        aria-label="Add hue curve point"
        onClick={handleAddTestPoint}
        style={{ visibility: "hidden", position: "absolute" }}
      >
        +
      </button>
    </div>
  );
}
