import { theme, useStore } from "@palmier/ui";
import type { EditorStore } from "@palmier/core";

interface AppProps {
  store: EditorStore;
}

export function App({ store }: AppProps) {
  const playhead = useStore(store, (s) => s.playhead);

  return (
    <div
      style={{
        background: theme.bg.base,
        color: theme.text.primary,
        fontFamily: "system-ui, sans-serif",
        fontSize: theme.fontSize.md,
        minHeight: "100dvh",
        padding: theme.spacing.xl,
      }}
    >
      <div
        style={{
          background: theme.bg.surface,
          borderRadius: theme.radius.md,
          border: `1px solid ${theme.border.primary}`,
          padding: theme.spacing.lg,
        }}
      >
        <div style={{ color: theme.text.secondary, fontSize: theme.fontSize.sm }}>
          Playhead
        </div>
        <div
          data-testid="playhead"
          style={{ color: theme.accent.timecode, fontSize: theme.fontSize.xl }}
        >
          {playhead}
        </div>
      </div>
    </div>
  );
}
