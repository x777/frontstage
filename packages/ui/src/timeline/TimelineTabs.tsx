import { theme } from "../theme/theme.js";
import { Icon, IconButton } from "../primitives/index.js";
import { useStore } from "../store/use-store.js";
import type { EditorStore } from "@frontstage/core";

export function TimelineTabs({ store }: { store: EditorStore }) {
  const timelines = useStore(store, (s) => s.timelines);
  const activeId = useStore(store, (s) => s.activeTimelineId);
  if (timelines.length <= 1) return null;

  return (
    <div
      role="tablist"
      aria-label="Timelines"
      style={{
        display: "flex",
        alignItems: "center",
        gap: theme.spacing.xxs,
        padding: `${theme.spacing.xxs} ${theme.spacing.sm}`,
        background: theme.bg.surface,
        borderBottom: `${theme.borderWidth.hairline} solid ${theme.border.divider}`,
        minHeight: theme.size.toolbar,
        overflowX: "auto",
      }}
    >
      {timelines.map((t) => {
        const active = t.id === activeId;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => store.activateTimeline(t.id!)}
            onDoubleClick={() => {
              const next = window.prompt("Rename timeline", t.name ?? "");
              if (next) store.renameTimeline(t.id!, next);
            }}
            style={{
              appearance: "none",
              border: "none",
              background: active ? theme.bg.raised : "transparent",
              color: active ? theme.text.primary : theme.text.secondary,
              fontSize: theme.fontSize.xs,
              fontWeight: active ? theme.fontWeight.semibold : theme.fontWeight.regular,
              padding: `${theme.spacing.xxs} ${theme.spacing.sm}`,
              borderRadius: theme.radius.sm,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {t.name ?? "Timeline"}
          </button>
        );
      })}
      <IconButton title="New timeline" frame="sm" onClick={() => store.createTimeline()} testid="timeline-new">
        <Icon name="plus" />
      </IconButton>
      {timelines.length > 1 ? (
        <IconButton title="Delete timeline" frame="sm" onClick={() => store.deleteTimeline(activeId)} testid="timeline-delete">
          <Icon name="x" />
        </IconButton>
      ) : null}
    </div>
  );
}
