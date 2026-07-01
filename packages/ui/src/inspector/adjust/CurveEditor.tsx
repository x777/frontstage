import { useRef, useEffect, useState } from "react";
import type { GradeCurve, CurvePoint } from "@palmier/core";
import {
  displayPoints,
  nearestPoint,
  addPoint,
  movePoint,
  removePoint,
  evalPolyline,
} from "@palmier/core";
import { theme } from "../../theme/theme.js";

// Canvas colors mirror their CSS tokens (ctx can't consume CSS vars).
const GRID_COLOR = "rgba(255,255,255,0.12)";   // matches --color-adjust-curve-grid
const BORDER_COLOR = "rgba(255,255,255,0.16)";  // matches --color-adjust-curve-border
const IDENTITY_COLOR = "rgba(255,255,255,0.20)"; // matches --color-adjust-curve-identity
const CURVE_Y = "#ffffff";                        // matches --color-adjust-curve-y
const CURVE_R = "#ff4444";                        // matches --color-adjust-curve-r
const CURVE_G = "#44cc44";                        // matches --color-adjust-curve-g
const CURVE_B = "#4488ff";                        // matches --color-adjust-curve-b

const DOT_RADIUS = 4.5;
const HIT_RADIUS = 0.08; // normalized [0,1] space hit threshold
const CANVAS_SIZE = 180;
const POLYLINE_STEPS = 64;

type Channel = "master" | "red" | "green" | "blue";

const CHANNEL_LABELS: Record<Channel, string> = {
  master: "Y",
  red: "R",
  green: "G",
  blue: "B",
};

function channelColor(ch: Channel): string {
  if (ch === "red")   return CURVE_R;
  if (ch === "green") return CURVE_G;
  if (ch === "blue")  return CURVE_B;
  return CURVE_Y;
}

function getChannelPts(curve: GradeCurve, ch: Channel): CurvePoint[] {
  return curve[ch];
}

function withChannelPts(curve: GradeCurve, ch: Channel, pts: CurvePoint[]): GradeCurve {
  return { ...curve, [ch]: pts };
}

// Active editable points: use displayPoints only for drawing; for editing, if the
// stored array is empty (identity), seed from displayPoints so addPoint has endpoints.
function activePts(stored: CurvePoint[]): CurvePoint[] {
  return stored.length >= 2 ? stored : displayPoints(stored).map((p) => ({ ...p }));
}

function canvasToCurve(cx: number, cy: number, w: number, h: number): [number, number] {
  return [cx / w, 1 - cy / h]; // y-inverted: canvas y-down, curve y-up
}

export interface CurveEditorProps {
  curve: GradeCurve;
  channel: Channel;
  onChannel: (c: Channel) => void;
  onChange: (curve: GradeCurve) => void;
  onCommit: () => void;
  histogram?: { y: number[]; r: number[]; g: number[]; b: number[] };
}

export function CurveEditor({
  curve,
  channel,
  onChannel,
  onChange,
  onCommit,
  histogram,
}: CurveEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef<{ index: number } | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(-1);

  const stored = getChannelPts(curve, channel);
  const dispPts = displayPoints(stored);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return; // jsdom guard — no drawing, interactive wrapper still works

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // TODO (Task 3): draw histogram backdrop when `histogram` is present

    // Border
    ctx.strokeStyle = BORDER_COLOR;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

    // Quarter grid (0 / .25 / .5 / .75 / 1)
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 0.5;
    for (const f of [0.25, 0.5, 0.75]) {
      ctx.beginPath(); ctx.moveTo(f * W, 0); ctx.lineTo(f * W, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, f * H); ctx.lineTo(W, f * H); ctx.stroke();
    }

    // Dashed identity diagonal
    ctx.strokeStyle = IDENTITY_COLOR;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(0, H); ctx.lineTo(W, 0);
    ctx.stroke();
    ctx.setLineDash([]);

    // Active channel curve polyline
    const polyline = evalPolyline(dispPts, POLYLINE_STEPS);
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
  }, [curve, channel, dispPts, histogram]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = e.currentTarget;
    canvas.setPointerCapture(e.pointerId);
    const rect = canvas.getBoundingClientRect();
    const [x, y] = canvasToCurve(
      e.clientX - rect.left, e.clientY - rect.top,
      canvas.width, canvas.height,
    );
    const editable = activePts(stored);
    const idx = nearestPoint(editable, x, y, HIT_RADIUS);
    if (idx >= 0) {
      dragging.current = { index: idx };
      setSelectedIdx(idx);
    } else {
      const { points: newPts, index } = addPoint(editable, x, y);
      dragging.current = { index };
      setSelectedIdx(index);
      onChange(withChannelPts(curve, channel, newPts));
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
    const editable = activePts(stored);
    const newPts = movePoint(editable, dragging.current.index, x, y);
    onChange(withChannelPts(curve, channel, newPts));
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
    const editable = activePts(stored);
    const idx = nearestPoint(editable, x, y, HIT_RADIUS);
    if (idx < 0) return;
    const newPts = removePoint(editable, idx);
    if (newPts === editable) return; // endpoint or min-2, unchanged
    onChange(withChannelPts(curve, channel, newPts));
    onCommit();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (selectedIdx < 0) return;
    const editable = activePts(stored);
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
    onChange(withChannelPts(curve, channel, newPts));
    onCommit();
  };

  // Testable path: adds a midpoint at (0.5, 0.75) on the active channel
  // so jsdom tests can trigger an edit without canvas pointer geometry.
  const handleAddTestPoint = () => {
    const editable = activePts(stored);
    const { points: newPts, index } = addPoint(editable, 0.5, 0.75);
    setSelectedIdx(index);
    onChange(withChannelPts(curve, channel, newPts));
    onCommit();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: theme.spacing.xxs }}>
      {/* Channel picker: Y / R / G / B */}
      <div style={{ display: "flex", gap: theme.spacing.xxs }}>
        {(["master", "red", "green", "blue"] as Channel[]).map((ch) => (
          <button
            key={ch}
            data-testid={`curve-channel-${ch}`}
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
        data-testid="curve-canvas"
        style={{
          width: "100%",
          height: `${CANVAS_SIZE}px`,
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
      {/* Testable edit affordance — keyboard/button path for tests (jsdom has no canvas geometry) */}
      <button
        data-testid="curve-add-point"
        aria-label="Add curve point"
        onClick={handleAddTestPoint}
        style={{ fontSize: theme.fontSize.xxs, color: theme.text.muted, background: "none",
          border: `${theme.borderWidth.hairline} solid ${theme.border.subtle}`,
          borderRadius: theme.radius.xs, padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
          cursor: "pointer", alignSelf: "flex-start" }}
      >
        +
      </button>
    </div>
  );
}
