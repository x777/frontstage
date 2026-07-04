import { theme } from "../theme/theme.js";
import { useHover } from "./use-hover.js";

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
    <div
      data-testid={testid}
      onClick={() => {
        if (disabled) return;
        onSelect(id);
      }}
      {...hoverProps}
      style={{
        height: theme.iconSize.mdLg,
        display: "flex",
        alignItems: "center",
        background: !disabled && hovered ? `rgba(255, 255, 255, ${theme.opacity.soft})` : "transparent",
        color: disabled ? theme.text.muted : destructive ? theme.status.error : theme.text.primary,
        borderRadius: theme.radius.xs,
        fontSize: theme.fontSize.sm,
        padding: `${theme.spacing.xxs} ${theme.spacing.sm}`,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {label}
    </div>
  );
}

export function MenuList(props: {
  items: readonly { id: string; label: string; disabled?: boolean; destructive?: boolean }[];
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
        <MenuRow
          key={item.id}
          id={item.id}
          label={item.label}
          disabled={item.disabled}
          destructive={item.destructive}
          onSelect={onSelect}
          testid={testid ? `${testid}-${item.id}` : undefined}
        />
      ))}
    </div>
  );
}
