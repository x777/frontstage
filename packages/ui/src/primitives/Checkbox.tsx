import { theme } from "../theme/theme.js";

export function Checkbox(props: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
  testid?: string;
}) {
  const { checked, onChange, label, disabled, testid } = props;
  const dim = theme.iconSize.xs;

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      data-testid={testid}
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        onChange(!checked);
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: theme.spacing.xs,
        background: "transparent",
        border: "none",
        padding: 0,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? theme.opacity.disabled : theme.opacity.opaque,
      }}
    >
      <span
        style={{
          width: dim,
          height: dim,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: checked ? theme.accent.primary : "transparent",
          border: `${theme.borderWidth.thin} solid ${theme.border.primary}`,
          borderRadius: theme.radius.xs,
          fontSize: theme.fontSize.xxs,
          color: theme.text.onAccent,
        }}
      >
        {checked ? "✓" : ""}
      </span>
      {label && <span style={{ fontSize: theme.fontSize.sm, color: theme.text.secondary }}>{label}</span>}
    </button>
  );
}
