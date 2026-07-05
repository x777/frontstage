import { theme } from "../../theme/theme.js";
import { Checkbox } from "../../primitives/index.js";

export interface AdjustSectionProps {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  canReset: boolean;
  onReset: () => void;
  enabled: boolean;
  onToggleEnabled: () => void;
  canEnable: boolean;
  children: React.ReactNode;
}

export function AdjustSection({
  title,
  expanded,
  onToggle,
  canReset,
  onReset,
  enabled,
  onToggleEnabled,
  canEnable,
  children,
}: AdjustSectionProps) {
  return (
    <div
      style={{
        borderBottom: `${theme.borderWidth.hairline} solid ${theme.border.divider}`,
      }}
    >
      <div
        onClick={onToggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: theme.spacing.xs,
          padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
          cursor: "pointer",
          userSelect: "none",
        }}
        data-testid={`adjust-section-${title}`}
      >
        <span
          style={{
            display: "inline-block",
            transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
            fontSize: theme.fontSize.xs,
            color: theme.text.secondary,
            flexShrink: 0,
          }}
          aria-hidden="true"
        >
          ▶
        </span>
        <span
          style={{
            flex: 1,
            fontSize: theme.fontSize.xxs,
            fontWeight: theme.fontWeight.semibold,
            letterSpacing: theme.letterSpacing.wide,
            textTransform: "uppercase",
            color: theme.text.muted,
          }}
        >
          {title}
        </span>
        {canReset && (
          <button
            onClick={(e) => { e.stopPropagation(); onReset(); }}
            style={{
              background: "none",
              border: "none",
              padding: `0 ${theme.spacing.xxs}`,
              color: theme.text.tertiary,
              fontSize: theme.fontSize.sm,
              cursor: "pointer",
              flexShrink: 0,
            }}
            data-testid={`adjust-section-reset-${title}`}
          >
            ↺
          </button>
        )}
        <span onClick={(e) => e.stopPropagation()} style={{ display: "flex", flexShrink: 0 }}>
          <Checkbox
            checked={enabled}
            disabled={!canEnable}
            onChange={() => onToggleEnabled()}
            testid={`adjust-section-enable-${title}`}
          />
        </span>
      </div>
      {expanded && (
        <div
          style={{
            padding: `${theme.spacing.xxs} ${theme.spacing.sm} ${theme.spacing.xs}`,
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
