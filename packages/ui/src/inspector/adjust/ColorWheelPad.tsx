import { useRef, useEffect } from "react";
import { wheelDisplayColor, pointToXY, xyToPuck } from "@frontstage/core";
import { theme } from "../../theme/theme.js";

const NUDGE = 0.05;
const PUCK_RADIUS = 5; // matches --size-color-wheel-puck (10px)
// Canvas colors mirror their tokens (ctx can't consume CSS vars).
const RING_COLOR = "rgba(255,255,255,0.50)";        // matches --color-adjust-wheel-ring
const CROSSHAIR_COLOR = "rgba(255,255,255,0.25)";   // matches --color-adjust-wheel-crosshair
const PUCK_FILL = "#ffffff";                         // matches --color-adjust-wheel-puck-fill
const PUCK_STROKE = "rgba(0,0,0,0.50)";             // matches --color-adjust-wheel-puck-stroke

export interface ColorWheelPadProps {
  x: number;
  y: number;
  size: number;
  title?: string;
  onChange: (x: number, y: number) => void;
  onCommit: () => void;
}

export function ColorWheelPad({ x, y, size, title, onChange, onCommit }: ColorWheelPadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef(false);
  const discCache = useRef<{ size: number; data: ImageData } | null>(null);

  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return; // jsdom guard — skip drawing, keep interactive wrapper

    // Build disc bitmap (cached per size)
    if (!discCache.current || discCache.current.size !== size) {
      const imgData = ctx.createImageData(size, size);
      const data = imgData.data;
      for (let py = 0; py < size; py++) {
        for (let px = 0; px < size; px++) {
          const nx = (px - cx) / radius;
          const ny = -(py - cy) / radius;
          if (Math.hypot(nx, ny) <= 1) {
            const { r, g, b } = wheelDisplayColor(nx, ny);
            const i = (py * size + px) * 4;
            data[i]     = Math.round(r * 255);
            data[i + 1] = Math.round(g * 255);
            data[i + 2] = Math.round(b * 255);
            data[i + 3] = 255;
          }
        }
      }
      discCache.current = { size, data: imgData };
    }

    ctx.clearRect(0, 0, size, size);
    ctx.putImageData(discCache.current.data, 0, 0);

    // Crosshair
    ctx.strokeStyle = CROSSHAIR_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, 0);    ctx.lineTo(cx, size);
    ctx.moveTo(0, cy);    ctx.lineTo(size, cy);
    ctx.stroke();

    // Ring
    ctx.strokeStyle = RING_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 0.5, 0, Math.PI * 2);
    ctx.stroke();

    // Puck
    const { px: px_, py: py_ } = xyToPuck(x, y, cx, cy, radius);
    ctx.fillStyle = PUCK_FILL;
    ctx.beginPath();
    ctx.arc(px_, py_, PUCK_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = PUCK_STROKE;
    ctx.lineWidth = 1;
    ctx.stroke();
  }, [x, y, size, cx, cy, radius]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
    const rect = e.currentTarget.getBoundingClientRect();
    const { x: nx, y: ny } = pointToXY(e.clientX - rect.left, e.clientY - rect.top, cx, cy, radius);
    onChange(nx, ny);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const { x: nx, y: ny } = pointToXY(e.clientX - rect.left, e.clientY - rect.top, cx, cy, radius);
    onChange(nx, ny);
  };

  const onPointerUp = () => {
    if (!dragging.current) return;
    dragging.current = false;
    onCommit();
  };

  const onDoubleClick = () => {
    onChange(0, 0);
    onCommit();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    let nx = x;
    let ny = y;
    if      (e.key === "ArrowRight") nx = x + NUDGE;
    else if (e.key === "ArrowLeft")  nx = x - NUDGE;
    else if (e.key === "ArrowUp")    ny = y + NUDGE;
    else if (e.key === "ArrowDown")  ny = y - NUDGE;
    else return;
    e.preventDefault();
    const mag = Math.hypot(nx, ny);
    if (mag > 1) { nx /= mag; ny /= mag; }
    onChange(nx, ny);
    onCommit();
  };

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={title}
      aria-valuenow={Math.hypot(x, y)}
      aria-valuemin={0}
      aria-valuemax={1}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      onKeyDown={onKeyDown}
      style={{
        position: "relative",
        width: theme.size.colorWheelPad,
        height: theme.size.colorWheelPad,
        borderRadius: "50%",
        cursor: "crosshair",
        outline: "none",
        flexShrink: 0,
        overflow: "hidden",
      }}
    >
      <canvas
        ref={canvasRef}
        width={size}
        height={size}
        style={{ display: "block", pointerEvents: "none" }}
      />
    </div>
  );
}
