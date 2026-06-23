import { useRef } from "react";
import { theme } from "../theme/theme.js";

const labelToTestId = (label: string) =>
  "inspector-" + label.toLowerCase().replace(/\s+/g, "-");

const inputStyle: React.CSSProperties = {
  background: theme.bg.raised,
  color: theme.text.primary,
  border: `${theme.borderWidth.hairline} solid ${theme.border.primary}`,
  borderRadius: theme.radius.xs,
  padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
  fontSize: theme.fontSize.xs,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: theme.spacing.xs,
  padding: `${theme.spacing.xxs} 0`,
};

const labelStyle: React.CSSProperties = {
  fontSize: theme.fontSize.xs,
  color: theme.text.secondary,
  minWidth: theme.size.inspectorLabel,
  flexShrink: 0,
};

export interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  format?: (v: number) => string;
}

export function NumberField({ label, value, onChange, onCommit, step = 1, min, max, format }: NumberFieldProps) {
  const testId = labelToTestId(label);
  const scrubRef = useRef<{ startX: number; startValue: number } | null>(null);
  const localRef = useRef<number>(value);
  localRef.current = value;

  const clamp = (v: number) => {
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    return v;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLSpanElement>) => {
    e.preventDefault();
    (e.currentTarget as HTMLSpanElement).setPointerCapture(e.pointerId);
    scrubRef.current = { startX: e.clientX, startValue: localRef.current };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLSpanElement>) => {
    const d = scrubRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const next = clamp(d.startValue + dx * step);
    onChange(next);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!scrubRef.current) return;
    scrubRef.current = null;
    onCommit?.(localRef.current);
  };

  const displayValue = format ? format(value) : String(Number(value.toFixed(4)));

  return (
    <div style={rowStyle} data-testid={testId}>
      <span
        style={{ ...labelStyle, cursor: "ew-resize", userSelect: "none" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {label}
      </span>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          const v = clamp(Number(e.target.value));
          if (!isNaN(v)) onChange(v);
        }}
        onBlur={() => onCommit?.(localRef.current)}
        style={inputStyle}
        data-testid={testId + "-input"}
      />
    </div>
  );
}

export interface SliderFieldProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}

export function SliderField({ label, value, onChange, onCommit, min = 0, max = 1, step }: SliderFieldProps) {
  const testId = labelToTestId(label);
  return (
    <div style={rowStyle} data-testid={testId}>
      <span style={labelStyle}>{label}</span>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step ?? (max - min) / 100}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={(e) => onCommit?.((e.target as HTMLInputElement).valueAsNumber)}
        style={{ flex: 1 }}
        data-testid={testId + "-input"}
      />
      <span style={{ ...labelStyle, minWidth: theme.size.inspectorValue, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        {value.toFixed(2)}
      </span>
    </div>
  );
}

export interface ToggleFieldProps {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}

export function ToggleField({ label, value, onChange }: ToggleFieldProps) {
  const testId = labelToTestId(label);
  return (
    <div style={rowStyle} data-testid={testId}>
      <span style={labelStyle}>{label}</span>
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        data-testid={testId + "-input"}
      />
    </div>
  );
}

export interface TextFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onCommit?: (v: string) => void;
}

export function TextField({ label, value, onChange, onCommit }: TextFieldProps) {
  const testId = labelToTestId(label);
  return (
    <div style={rowStyle} data-testid={testId}>
      <span style={labelStyle}>{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => onCommit?.(e.target.value)}
        style={inputStyle}
        data-testid={testId + "-input"}
      />
    </div>
  );
}

export interface SectionProps {
  title: string;
  children: React.ReactNode;
}

export function Section({ title, children }: SectionProps) {
  return (
    <div
      data-testid={`inspector-section-${title}`}
      style={{
        borderBottom: `${theme.borderWidth.hairline} solid ${theme.border.divider}`,
        padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
      }}
    >
      <div
        style={{
          fontSize: theme.fontSize.micro,
          fontWeight: theme.fontWeight.semibold,
          color: theme.text.tertiary,
          letterSpacing: theme.letterSpacing.wide,
          textTransform: "uppercase",
          marginBottom: theme.spacing.xxs,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}
