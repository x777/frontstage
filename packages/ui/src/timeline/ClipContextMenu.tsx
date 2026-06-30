import { useStore } from "../store/use-store.js";
import { theme } from "../theme/theme.js";
import { canLinkSelection, canUnlinkSelection, dispatchLinkSelection, dispatchUnlinkSelection, type EditorStore } from "@palmier/core";

export interface ClipContextMenuState { x: number; y: number }

export function ClipContextMenu({ store, menu, onClose }: { store: EditorStore; menu: ClipContextMenuState | null; onClose: () => void }) {
  const selection = useStore(store, (s) => s.selection);
  const timeline = useStore(store, (s) => s.timeline);
  if (!menu) return null;
  const canLink = canLinkSelection(timeline, selection);
  const canUnlink = canUnlinkSelection(timeline, selection);

  const item = (testid: string, label: string, enabled: boolean, run: () => void) => (
    <button
      data-testid={testid}
      disabled={!enabled}
      onClick={() => { run(); onClose(); }}
      style={{
        display: "block", width: "100%", textAlign: "left", border: "none",
        background: "transparent", color: enabled ? theme.text.primary : theme.text.muted,
        cursor: enabled ? "pointer" : "default",
        padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
        fontSize: theme.fontSize.sm,
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      data-testid="clip-context-menu"
      role="menu"
      style={{
        position: "absolute", left: menu.x, top: menu.y, zIndex: theme.z.menu,
        background: theme.bg.raised, border: `${theme.borderWidth.hairline} solid ${theme.border.divider}`,
        borderRadius: theme.radius.sm, padding: theme.spacing.xxs, minWidth: theme.size.menuMin,
        boxShadow: theme.shadow.lg,
      }}
    >
      {item("ctx-link", "Link", canLink, () => dispatchLinkSelection(store))}
      {item("ctx-unlink", "Unlink", canUnlink, () => dispatchUnlinkSelection(store))}
    </div>
  );
}
