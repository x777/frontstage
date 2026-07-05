import { useState } from "react";
import { theme } from "../theme/theme.js";

export function TextInput(props: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  testid?: string;
  type?: string;
  min?: number | string;
  max?: number | string;
  step?: number | string;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  onBlur?: () => void;
  style?: React.CSSProperties;
}) {
  const { value, onChange, placeholder, disabled, testid, type = "text", min, max, step, onKeyDown, onBlur, style } = props;
  const [focused, setFocused] = useState(false);

  return (
    <input
      type={type}
      data-testid={testid}
      disabled={disabled}
      value={value}
      placeholder={placeholder}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      onFocus={() => setFocused(true)}
      onBlur={() => { setFocused(false); onBlur?.(); }}
      style={{
        background: theme.bg.raised,
        color: theme.text.primary,
        outline: "none",
        borderWidth: theme.borderWidth.thin,
        borderStyle: "solid",
        borderColor: focused ? theme.accent.primary : theme.border.primary,
        borderRadius: theme.radius.xsSm,
        fontSize: theme.fontSize.sm,
        padding: `${theme.spacing.xxs} ${theme.spacing.sm}`,
        transition: `border-color ${theme.anim.hover} ease-out`,
        opacity: disabled ? theme.opacity.disabled : theme.opacity.opaque,
        cursor: disabled ? "not-allowed" : "text",
        ...style,
      }}
    />
  );
}
