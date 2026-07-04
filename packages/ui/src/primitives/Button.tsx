import { theme } from "../theme/theme.js";
import { useHover } from "./use-hover.js";

export function Button(props: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "default" | "accent" | "destructive";
  gradient?: "ai";
  disabled?: boolean;
  title?: string;
  testid?: string;
  type?: "button" | "submit";
  style?: React.CSSProperties;
}) {
  const { children, onClick, variant = "default", gradient, disabled, title, testid, type = "button", style } = props;
  const { hovered, hoverProps } = useHover();

  const background =
    variant === "accent"
      ? gradient === "ai"
        ? theme.gradients.ai
        : theme.accent.primary
      : variant === "destructive"
        ? theme.status.error
        : hovered
          ? theme.bg.prominent
          : theme.bg.raised;

  const color = variant === "accent" ? theme.text.onAccent : theme.text.primary;

  return (
    <button
      type={type}
      title={title}
      data-testid={testid}
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        onClick?.();
      }}
      {...hoverProps}
      style={{
        background,
        color,
        border: variant === "default" ? `${theme.borderWidth.thin} solid ${theme.border.primary}` : "none",
        borderRadius: theme.radius.sm,
        fontSize: theme.fontSize.sm,
        fontWeight: theme.fontWeight.medium,
        padding: `${theme.spacing.xxs} ${theme.spacing.sm}`,
        transition: `background ${theme.anim.hover} ease-out`,
        opacity: disabled ? theme.opacity.disabled : theme.opacity.opaque,
        cursor: disabled ? "not-allowed" : "pointer",
        ...style,
      }}
    >
      {children}
    </button>
  );
}
