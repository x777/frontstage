import { useRef, useState } from "react";
import { scrubDelta } from "@palmier/core";
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
    const parsed = parseFloat(editText);
    if (!isNaN(parsed)) {
      onChange(clamp(parsed));
      onCommit();
    }
    setEditing(false);
  };

  const cancelEdit = () => setEditing(false);

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
          width: theme.size.inspectorValue,
          background: theme.bg.raised,
          color: theme.accent.primary,
          border: `${theme.borderWidth.hairline} solid ${theme.border.primary}`,
          borderRadius: theme.radius.xs,
          fontSize: theme.fontSize.xs,
          textAlign: "right",
          outline: "none",
          padding: `0 ${theme.spacing.xxs}`,
          fontVariantNumeric: "tabular-nums",
          flexShrink: 0,
          boxSizing: "border-box",
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
        display: "inline-block",
        width: theme.size.inspectorValue,
        textAlign: "right",
        fontSize: theme.fontSize.xs,
        color: value === null ? theme.text.muted : theme.accent.primary,
        cursor: "ew-resize",
        userSelect: "none",
        fontVariantNumeric: "tabular-nums",
        flexShrink: 0,
      }}
      data-testid="scrub-field"
    >
      {value === null ? "—" : format(value)}
    </span>
  );
}
