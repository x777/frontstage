import { useState } from "react";
import { theme } from "../theme/theme.js";
import { TextInput } from "./TextInput.js";

export function SearchField(props: Omit<Parameters<typeof TextInput>[0], "type">) {
  const { value, onChange, placeholder, disabled, testid, onKeyDown, style } = props;
  const [focused, setFocused] = useState(false);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: theme.spacing.xxs,
        background: theme.bg.raised,
        borderWidth: theme.borderWidth.thin,
        borderStyle: "solid",
        borderColor: focused ? theme.accent.primary : theme.border.primary,
        borderRadius: theme.radius.xsSm,
        padding: `${theme.spacing.xxs} ${theme.spacing.sm}`,
        transition: `border-color ${theme.anim.hover} ease-out`,
        opacity: disabled ? theme.opacity.disabled : theme.opacity.opaque,
        ...style,
      }}
    >
      <span style={{ color: theme.text.muted, fontSize: theme.fontSize.sm }}>🔍</span>
      <input
        type="text"
        data-testid={testid}
        disabled={disabled}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          flex: 1,
          minWidth: 0,
          background: "transparent",
          color: theme.text.primary,
          border: "none",
          outline: "none",
          fontSize: theme.fontSize.sm,
          padding: 0,
        }}
      />
    </div>
  );
}
