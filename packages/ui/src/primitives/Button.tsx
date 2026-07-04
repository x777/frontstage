import { useState } from "react";
import { theme } from "../theme/theme.js";
import { useHover } from "./use-hover.js";

// The Swift CapsuleButtonStyle (UI/CapsuleButton.swift) — the app's labeled-button family.
// default = Swift .secondary (prominent bg, secondary text); accent = .prominent (accent-primary
// or the ai gradient, dark on-accent text); destructive is our extension on the same chrome.
// Hover = white@faint overlay (an inset shadow fills the pill); pressed = opacity strong.
export function Button(props: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: "default" | "accent" | "destructive";
  gradient?: "ai";
  disabled?: boolean;
  title?: string;
  testid?: string;
  type?: "button" | "submit";
  size?: "small" | "regular";
  style?: React.CSSProperties;
}) {
  const { children, onClick, variant = "default", gradient, disabled, title, testid, type = "button", size = "small", style } = props;
  const { hovered, hoverProps } = useHover();
  const [pressed, setPressed] = useState(false);

  const background =
    variant === "accent"
      ? gradient === "ai"
        ? theme.gradients.ai
        : theme.accent.primary
      : variant === "destructive"
        ? theme.status.error
        : theme.bg.prominent;

  const color =
    variant === "accent" ? theme.text.onAccent : variant === "destructive" ? theme.text.primary : theme.text.secondary;

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
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => {
        setPressed(false);
        hoverProps.onMouseLeave();
      }}
      style={{
        background,
        color,
        border: "none",
        borderRadius: theme.radius.pill,
        fontSize: size === "small" ? theme.fontSize.xs : theme.fontSize.smMd,
        fontWeight: theme.fontWeight.medium,
        padding: size === "small" ? `${theme.spacing.xs} ${theme.spacing.smMd}` : `${theme.spacing.smMd} ${theme.spacing.lgXl}`,
        boxShadow: hovered && !disabled ? "inset 0 0 0 999px rgba(255, 255, 255, var(--opacity-faint))" : "none",
        transition: `box-shadow ${theme.anim.hover} ease-out, opacity ${theme.anim.hover} ease-out`,
        opacity: disabled ? theme.opacity.disabled : pressed ? theme.opacity.strong : theme.opacity.opaque,
        cursor: disabled ? "not-allowed" : "pointer",
        ...style,
      }}
    >
      {children}
    </button>
  );
}
