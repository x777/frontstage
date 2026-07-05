import { useRef, useState } from "react";
import { scrubDelta } from "@frontstage/core";
import { theme } from "../../theme/theme.js";

export interface ScrubbableNumberFieldProps {
  value: number | null;
  min: number;
  max: number;
  onChange: (v: number) => void;
  onCommit: () => void;
  format: (v: number) => string;
}

export function ScrubbableNumberField({
  value,
  min,
  max,
  onChange,
  onCommit,
  format,
}: ScrubbableNumberFieldProps) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const scrubRef = useRef<{ startX: number; startValue: number; moved: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);

  const clamp = (v: number) => Math.max(min, Math.min(max, v));

  const handlePointerDown = (e: React.PointerEvent<HTMLSpanElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubRef.current = {
      startX: e.clientX,
      startValue: value ?? (min + max) / 2,
      moved: false,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLSpanElement>) => {
    const s = scrubRef.current;
    if (!s) return;
    const dx = e.clientX - s.startX;
    if (Math.abs(dx) > 2) s.moved = true;
    if (!s.moved) return;
    const delta = scrubDelta(dx, min, max, { shift: e.shiftKey, meta: e.metaKey });
    onChange(clamp(s.startValue + delta));
  };

  const handlePointerUp = () => {
    const s = scrubRef.current;
    scrubRef.current = null;
    if (s?.moved) {
      onCommit();
    } else {
      setEditText(value !== null ? format(value) : "");
      setEditing(true);
    }
  };

  const commitEdit = () => {
    if (!cancelRef.current) {
      const parsed = parseFloat(editText);
      if (!isNaN(parsed)) { onChange(clamp(parsed)); onCommit(); }
    }
    cancelRef.current = false;
    setEditing(false);
  };

  const cancelEdit = () => { cancelRef.current = true; setEditing(false); };

  // Matches Swift's ScrubbableNumberField: sm/medium/tabular-nums, no visible box chrome (plain
  // inline text, per SwiftUI's `.plain` TextField style) — only the foreground color distinguishes
  // editing (primary) from display (accent when interactive, tertiary when mixed).
  const baseFieldStyle: React.CSSProperties = {
    width: theme.size.inspectorValue,
    textAlign: "right",
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    fontVariantNumeric: "tabular-nums",
    padding: `${theme.spacing.xxs} ${theme.spacing.sm}`,
    flexShrink: 0,
    boxSizing: "border-box",
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="text"
        autoFocus
        value={editText}
        onChange={(e) => setEditText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commitEdit(); }
          if (e.key === "Escape") { e.preventDefault(); cancelEdit(); }
        }}
        onBlur={commitEdit}
        style={{
          ...baseFieldStyle,
          background: "transparent",
          border: "none",
          outline: "none",
          color: theme.text.primary,
        }}
        data-testid="scrub-field-input"
      />
    );
  }

  return (
    <span
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{
        ...baseFieldStyle,
        display: "inline-block",
        color: value === null ? theme.text.tertiary : theme.accent.primary,
        cursor: "ew-resize",
        userSelect: "none",
      }}
      data-testid="scrub-field"
    >
      {value === null ? "—" : format(value)}
    </span>
  );
}
