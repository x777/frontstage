import { Fragment } from "react";
import { theme } from "../theme/theme.js";
import { useHover } from "./use-hover.js";

export interface MenuListItem {
  id: string;
  label: string;
  disabled?: boolean;
  destructive?: boolean;
  // Overrides the auto-derived `${testid}-${id}` row testid — needed when a row must carry a
  // pre-existing testid verbatim (e.g. moving a standalone button's testid onto a menu row).
  testid?: string;
  // Renders a thin divider above this row — the NSMenu .separator() analog (Swift MainMenu.swift).
  separatorBefore?: boolean;
  // Renders `label` as an inert section caption (canonical xxs/semibold/wide/muted/uppercase, same
  // language as inspector Section headers) instead of a clickable row — e.g. FileMenu's "Open Recent".
  header?: boolean;
  // Escape hatch for a row that isn't a plain label+onSelect button — e.g. FileMenu's FCPXML
  // target/version pickers. `label`/`onSelect` are ignored for this entry when set.
  content?: React.ReactNode;
}

function MenuRow(props: {
  id: string;
  label: string;
  disabled?: boolean;
  destructive?: boolean;
  onSelect: (id: string) => void;
  testid?: string;
}) {
  const { id, label, disabled, destructive, onSelect, testid } = props;
  const { hovered, hoverProps } = useHover();

  return (
    <button
      type="button"
      role="menuitem"
      data-testid={testid}
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        onSelect(id);
      }}
      {...hoverProps}
      style={{
        height: theme.iconSize.mdLg,
        display: "flex",
        alignItems: "center",
        width: "100%",
        border: "none",
        textAlign: "left",
        background: !disabled && hovered ? `rgba(255, 255, 255, ${theme.opacity.soft})` : "transparent",
        color: disabled ? theme.text.muted : destructive ? theme.status.error : theme.text.primary,
        borderRadius: theme.radius.xs,
        fontSize: theme.fontSize.sm,
        padding: `${theme.spacing.xxs} ${theme.spacing.sm}`,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {label}
    </button>
  );
}

function MenuSeparator() {
  return <div style={{ height: theme.borderWidth.thin, background: theme.border.divider, margin: `${theme.spacing.xxs} 0` }} />;
}

const headerStyle: React.CSSProperties = {
  fontSize: theme.fontSize.xxs,
  fontWeight: theme.fontWeight.semibold,
  color: theme.text.muted,
  letterSpacing: theme.letterSpacing.wide,
  textTransform: "uppercase",
  padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
};

export function MenuList(props: {
  items: readonly MenuListItem[];
  onSelect: (id: string) => void;
  testid?: string;
}) {
  const { items, onSelect, testid } = props;

  return (
    <div
      style={{
        background: theme.bg.prominent,
        border: `${theme.borderWidth.thin} solid ${theme.border.subtle}`,
        borderRadius: theme.radius.sm,
        boxShadow: theme.shadow.md,
        padding: theme.spacing.xxs,
        minWidth: theme.size.menuMin,
      }}
    >
      {items.map((item) => (
        <Fragment key={item.id}>
          {item.separatorBefore && <MenuSeparator />}
          {item.content ? (
            item.content
          ) : item.header ? (
            <div style={headerStyle}>{item.label}</div>
          ) : (
            <MenuRow
              id={item.id}
              label={item.label}
              disabled={item.disabled}
              destructive={item.destructive}
              onSelect={onSelect}
              testid={item.testid ?? (testid ? `${testid}-${item.id}` : undefined)}
            />
          )}
        </Fragment>
      ))}
    </div>
  );
}
