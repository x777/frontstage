import { useRef } from "react";
import { theme } from "../theme/theme.js";
import { TextInput } from "../primitives/TextInput.js";
import { Checkbox } from "../primitives/Checkbox.js";

const labelToTestId = (label: string) =>
  "inspector-" + label.toLowerCase().replace(/\s+/g, "-");

export const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: theme.spacing.xs,
  padding: `${theme.spacing.xxs} 0`,
};

// Canonical inspector row label — matches Swift's InspectorRow (Inspector/Components/InspectorRow.swift):
// natural width (no fixed column), sm/medium/primary. Used for both editable property rows here and
// aligned into CaptionsTab, which is InspectorRow-based in Swift too.
export const labelStyle: React.CSSProperties = {
  fontSize: theme.fontSize.sm,
  fontWeight: theme.fontWeight.medium,
  color: theme.text.primary,
  whiteSpace: "nowrap",
  flexShrink: 0,
};

const valueStyle: React.CSSProperties = {
  fontSize: theme.fontSize.sm,
  color: theme.text.secondary,
  minWidth: theme.size.inspectorValue,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
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
      <TextInput
        type="number"
        value={String(value)}
        min={min}
        max={max}
        step={step}
        onChange={(v) => {
          const n = clamp(Number(v));
          if (!isNaN(n)) onChange(n);
        }}
        onBlur={() => onCommit?.(localRef.current)}
        testid={testId + "-input"}
        style={{ flex: 1 }}
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
      <span style={valueStyle}>
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
      <span style={{ flex: 1 }} />
      <Checkbox checked={value} onChange={onChange} testid={testId + "-input"} />
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
      <TextInput
        value={value}
        onChange={onChange}
        onBlur={() => onCommit?.(value)}
        testid={testId + "-input"}
        style={{ flex: 1 }}
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
          fontSize: theme.fontSize.xxs,
          fontWeight: theme.fontWeight.semibold,
          color: theme.text.muted,
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
