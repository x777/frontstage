import { theme } from "../theme/theme.js";
import { useHover } from "./use-hover.js";

export function IconButton(props: {
  children: React.ReactNode;
  onClick?: () => void;
  frame?: "xxs" | "xs" | "sm" | "smMd" | "md" | "mdLg" | "lg" | "lgXl" | "xl";
  active?: boolean;
  disabled?: boolean;
  title?: string;
  testid?: string;
  fontSize?: string;
}) {
  const { children, onClick, frame = "mdLg", active, disabled, title, testid, fontSize } = props;
  const { hovered, hoverProps } = useHover();

  const background =
    active && hovered
      ? `rgba(255, 255, 255, ${theme.opacity.muted})`
      : active
        ? `rgba(255, 255, 255, ${theme.opacity.soft})`
        : hovered
          ? `rgba(255, 255, 255, ${theme.opacity.faint})`
          : "transparent";

  const color = disabled ? theme.text.muted : active ? theme.text.primary : theme.text.secondary;
  const dim = theme.iconSize[frame];

  return (
    <button
      type="button"
      title={title}
      data-testid={testid}
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        onClick?.();
      }}
      {...hoverProps}
      style={{
        width: dim,
        height: dim,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background,
        color,
        border: "none",
        borderRadius: theme.radius.sm,
        fontSize: fontSize ?? theme.fontSize.md,
        padding: 0,
        transition: `background ${theme.anim.hover} ease-out`,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {children}
    </button>
  );
}
