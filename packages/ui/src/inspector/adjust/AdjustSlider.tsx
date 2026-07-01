import { useRef } from "react";
import { sliderFrac, sliderValue } from "@palmier/core";
import { theme } from "../../theme/theme.js";

const STEP_FRAC = 0.01;

export interface AdjustSliderProps {
  value: number | null;
  min: number;
  max: number;
  def: number;
  gradient?: "temperature" | "tint" | "luma" | "hue" | "none";
  onChange: (v: number) => void;
  onCommit: () => void;
}

export function AdjustSlider({
  value,
  min,
  max,
  def,
  gradient = "none",
  onChange,
  onCommit,
}: AdjustSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef(false);

  const mixed = value === null;
  const frac = mixed ? 0.5 : sliderFrac(value, min, max);
  const current: number = value ?? def;

  const getFrac = (e: React.PointerEvent) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return frac;
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = true;
    onChange(sliderValue(getFrac(e), min, max));
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    onChange(sliderValue(getFrac(e), min, max));
  };

  const handlePointerUp = () => {
    if (!dragRef.current) return;
    dragRef.current = false;
    onCommit();
  };

  const handleDoubleClick = () => {
    onChange(def);
    onCommit();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const step = (max - min) * STEP_FRAC;
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      next = Math.min(max, current + step);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      next = Math.max(min, current - step);
    }
    if (next !== null) {
      e.preventDefault();
      onChange(next);
      onCommit();
    }
  };

  const trackBg = (() => {
    switch (gradient) {
      case "temperature": return `linear-gradient(to right, ${theme.adjust.tempCool}, ${theme.adjust.tempWarm})`;
      case "tint": return `linear-gradient(to right, ${theme.adjust.tintGreen}, ${theme.adjust.tintMagenta})`;
      case "luma": return `linear-gradient(to right, ${theme.adjust.lumaDark}, ${theme.adjust.lumaLight})`;
      // Mirrors SPECTRUM_STOPS from HueCurveEditor: R→Y→G→C→B→M→R (7 stops, muted saturation/lightness).
      case "hue": return "linear-gradient(to right, hsl(0,72%,34%) 0%, hsl(60,72%,38%) 16.67%, hsl(120,68%,32%) 33.33%, hsl(180,68%,32%) 50%, hsl(240,64%,38%) 66.67%, hsl(300,64%,36%) 83.33%, hsl(360,72%,34%) 100%)";
      default: return theme.bg.prominent;
    }
  })();

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-valuenow={value ?? (min + max) / 2}
      aria-valuemin={min}
      aria-valuemax={max}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      style={{
        position: "relative",
        flex: 1,
        height: theme.size.adjustTrack,
        borderRadius: theme.radius.xl,
        background: trackBg,
        cursor: "ew-resize",
        outline: "none",
      }}
    >
      {gradient === "none" && (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: `${frac * 100}%`,
            borderRadius: theme.radius.xl,
            background: theme.text.primary,
            opacity: mixed ? theme.opacityNum.mixedFill : undefined,
            pointerEvents: "none",
          }}
        />
      )}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: `${frac * 100}%`,
          transform: "translate(-50%, -50%)",
          width: theme.size.adjustThumb,
          height: theme.size.adjustThumb,
          borderRadius: theme.radius.xl,
          background: mixed ? theme.text.muted : theme.text.primary,
          pointerEvents: "none",
        }}
      />
    </div>
  );
}
