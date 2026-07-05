import { theme } from "../theme/theme.js";
import { Dialog } from "../primitives/Dialog.js";
import type { ExportState } from "./use-export-command.js";

// ExportView.swift's progress state has no options-sheet analog to restyle here (M16F T1 scope) —
// it's just `ProgressView(value:).progressViewStyle(.linear)` (system control, no AppTheme literal)
// plus an `Int(progress*100)%` readout below it (xs/secondary/.monospacedDigit()). This card keeps
// the done/total count (existing test-bound content) but gives it that same readout treatment,
// below the bar, per Swift.
export function ExportProgress({ state }: { state: ExportState | null }) {
  if (!state) return null;

  const pct = Math.round((state.done / state.total) * 100);

  return (
    <Dialog>
      <div data-testid="export-progress" style={{ display: "flex", flexDirection: "column", gap: theme.spacing.xs }}>
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
        <div
          style={{
            height: theme.borderWidth.thick,
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
        <span
          style={{
            fontSize: theme.fontSize.xs,
            color: theme.text.secondary,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {state.done}/{state.total}
        </span>
      </div>
    </Dialog>
  );
}
