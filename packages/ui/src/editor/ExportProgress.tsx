import { theme } from "../theme/theme.js";
import type { ExportState } from "./use-export-command.js";

export function ExportProgress({ state }: { state: ExportState | null }) {
  if (!state) return null;

  const pct = Math.round((state.done / state.total) * 100);

  return (
    <div
      data-testid="export-progress"
      style={{
        position: "fixed",
        inset: 0,
        background: theme.bg.scrim,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: theme.z.dialog,
      }}
    >
      <div
        style={{
          background: theme.bg.raised,
          border: `${theme.borderWidth.thin} solid ${theme.border.primary}`,
          borderRadius: theme.radius.md,
          padding: theme.spacing.lg,
          minWidth: theme.size.dialogMin,
          boxShadow: theme.shadow.lg,
          display: "flex",
          flexDirection: "column",
          gap: theme.spacing.md,
        }}
      >
        <span
          data-testid="export-progress-label"
          style={{
            fontSize: theme.fontSize.sm,
            fontWeight: theme.fontWeight.medium,
            color: theme.text.primary,
          }}
        >
          {state.label}
        </span>
        <span
          style={{
            fontSize: theme.fontSize.xs,
            color: theme.text.secondary,
          }}
        >
          {state.done}/{state.total}
        </span>
        <div
          style={{
            height: theme.borderWidth.medium,
            background: theme.border.divider,
            borderRadius: theme.radius.xs,
            overflow: "hidden",
          }}
        >
          <div
            data-testid="export-progress-bar"
            style={{
              height: "100%",
              width: `${pct}%`,
              background: theme.accent.primary,
              borderRadius: theme.radius.xs,
            }}
          />
        </div>
      </div>
    </div>
  );
}
