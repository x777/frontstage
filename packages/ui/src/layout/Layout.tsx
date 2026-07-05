import { type ReactNode } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { type EditorStore, type FocusedPanel, PANEL_IDS, isValidPanel } from "@frontstage/core";
import { theme } from "../theme/theme.js";
import { useStore } from "../store/use-store.js";
import { PanelHeader, IconButton } from "../primitives/index.js";

const PERSIST_KEY = "frontstage.editor.ui";

export function persistLayout(store: EditorStore): void {
  const state = store.getSnapshot();
  try {
    localStorage.setItem(
      PERSIST_KEY,
      JSON.stringify({ layout: state.layout, view: state.view }),
    );
  } catch {
    // storage unavailable
  }
}

function isValidBlob(parsed: unknown): parsed is { layout: { maximized: FocusedPanel | null; hidden: FocusedPanel[]; focused: FocusedPanel }; view: { zoom: number; scrollX: number } } {
  if (!parsed || typeof parsed !== "object") return false;
  const p = parsed as Record<string, unknown>;

  const layout = p["layout"];
  if (!layout || typeof layout !== "object") return false;
  const l = layout as Record<string, unknown>;
  if (l["maximized"] !== null && !isValidPanel(l["maximized"])) return false;
  if (!Array.isArray(l["hidden"]) || !l["hidden"].every(isValidPanel)) return false;
  if (!isValidPanel(l["focused"])) return false;

  const view = p["view"];
  if (!view || typeof view !== "object") return false;
  const v = view as Record<string, unknown>;
  if (typeof v["zoom"] !== "number" || !isFinite(v["zoom"])) return false;
  if (typeof v["scrollX"] !== "number" || !isFinite(v["scrollX"])) return false;

  return true;
}

export function restoreLayout(store: EditorStore): void {
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!isValidBlob(parsed)) {
      localStorage.removeItem(PERSIST_KEY);
      return;
    }
    store.restore({
      layout: parsed.layout,
      view: parsed.view,
    });
  } catch {
    localStorage.removeItem(PERSIST_KEY);
  }
}

interface LayoutProps {
  store: EditorStore;
  media: ReactNode;
  preview: ReactNode;
  timeline: ReactNode;
  inspector: ReactNode;
  topBarSlot?: ReactNode;
  title?: string;
  agent?: ReactNode;
  agentVisible?: boolean;
}

const resizeHandleStyle: React.CSSProperties = {
  width: theme.size.resizeHandle,
  background: theme.border.divider,
  flexShrink: 0,
  cursor: "col-resize",
};

const resizeHandleHorizStyle: React.CSSProperties = {
  height: theme.size.resizeHandle,
  background: theme.border.divider,
  flexShrink: 0,
  cursor: "row-resize",
};

const panelSectionStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  height: "100%",
  background: theme.bg.surface,
};

export function Layout({ store, media, preview, timeline, inspector, topBarSlot, title, agent, agentVisible }: LayoutProps) {
  const layout = useStore(store, (s) => s.layout);

  function handleFocus(p: FocusedPanel) {
    store.setFocusedPanel(p);
  }

  function toggleMaximize(p: FocusedPanel) {
    store.setMaximized(layout.maximized === p ? null : p);
    persistLayout(store);
  }

  // A panel is visible only when it is not hidden AND (nothing is maximized OR it is the maximized one)
  const panelVisible = (p: FocusedPanel): boolean => {
    if (layout.hidden.includes(p)) return false;
    if (layout.maximized !== null && layout.maximized !== p) return false;
    return true;
  };

  // Focused-panel ring: EditorView.swift's PanelFocusRing overlay — an accent-colored stroke at
  // BorderWidth.medium, opacity 0.6 when focused / 0 when not, eased over Anim.transition.
  const panelStyle = (p: FocusedPanel): React.CSSProperties => ({
    ...panelSectionStyle,
    display: panelVisible(p) ? "flex" : "none",
    border: `${theme.borderWidth.medium} solid ${layout.focused === p ? theme.border.focusRing : "transparent"}`,
    transition: `border-color ${theme.anim.transition} ease-out`,
  });

  // In maximized mode the whole content area is a single flex column; otherwise use the resizable grid.
  const isMaximized = layout.maximized !== null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100dvh",
        background: theme.bg.base,
        color: theme.text.primary,
        fontFamily: "system-ui, sans-serif",
        fontSize: theme.fontSize.md,
      }}
    >
      <TopBar slot={topBarSlot} title={title} />
      {isMaximized ? (
        // Maximized mode: the active panel fills the content area; all others are display:none but stay mounted.
        <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
          {(["media", "preview", "timeline", "inspector"] as FocusedPanel[]).map((id) => {
            const contents: Record<FocusedPanel, ReactNode> = { media, preview, timeline, inspector };
            const labels: Record<FocusedPanel, string> = { media: "Media", preview: "Preview", timeline: "Timeline", inspector: "Inspector" };
            return (
              <section
                key={id}
                data-testid={`panel-${id}`}
                style={{ ...panelStyle(id), position: "absolute", inset: 0 }}
                onClick={() => handleFocus(id)}
              >
                <PanelHeader
                  title={labels[id]}
                  trailing={
                    <IconButton
                      frame="sm"
                      testid={`maximize-${id}`}
                      title={layout.maximized === id ? "Restore" : "Maximize"}
                      onClick={() => toggleMaximize(id)}
                      fontSize={theme.fontSize.sm}
                    >
                      {layout.maximized === id ? "⊙" : "⊕"}
                    </IconButton>
                  }
                />
                <div style={{ flex: 1, overflow: "hidden" }}>{contents[id]}</div>
              </section>
            );
          })}
        </div>
      ) : (
        <div style={{ flex: 1, overflow: "hidden" }}>
          <PanelGroup direction="horizontal" style={{ height: "100%" }}>
            {/* Media panel — left column; always mounted, hidden via CSS */}
            <Panel
              defaultSize={18}
              minSize={10}
              style={{ display: panelVisible("media") ? undefined : "none" }}
              onClick={() => handleFocus("media")}
            >
              <section data-testid="panel-media" style={panelStyle("media")}>
                <PanelHeader
                  title="Media"
                  trailing={
                    <IconButton
                      frame="sm"
                      testid="maximize-media"
                      title="Maximize"
                      onClick={() => toggleMaximize("media")}
                      fontSize={theme.fontSize.sm}
                    >
                      ⊕
                    </IconButton>
                  }
                />
                <div style={{ flex: 1, overflow: "hidden" }}>{media}</div>
              </section>
            </Panel>
            <PanelResizeHandle style={{ ...resizeHandleStyle, display: panelVisible("media") ? undefined : "none" }} />

            {/* Center column: preview (top) + timeline (bottom) — always mounted */}
            <Panel defaultSize={58} minSize={30}>
              <PanelGroup direction="vertical" style={{ height: "100%" }}>
                <Panel
                  defaultSize={55}
                  minSize={20}
                  style={{ display: panelVisible("preview") ? undefined : "none" }}
                  onClick={() => handleFocus("preview")}
                >
                  <section data-testid="panel-preview" style={panelStyle("preview")}>
                    <PanelHeader
                      title="Preview"
                      trailing={
                        <IconButton
                          frame="sm"
                          testid="maximize-preview"
                          title="Maximize"
                          onClick={() => toggleMaximize("preview")}
                          fontSize={theme.fontSize.sm}
                        >
                          ⊕
                        </IconButton>
                      }
                    />
                    <div style={{ flex: 1, overflow: "hidden" }}>{preview}</div>
                  </section>
                </Panel>
                <PanelResizeHandle style={{ ...resizeHandleHorizStyle, display: panelVisible("preview") ? undefined : "none" }} />
                <Panel
                  defaultSize={45}
                  minSize={15}
                  style={{ display: panelVisible("timeline") ? undefined : "none" }}
                  onClick={() => handleFocus("timeline")}
                >
                  <section data-testid="panel-timeline" style={panelStyle("timeline")}>
                    <PanelHeader
                      title="Timeline"
                      trailing={
                        <IconButton
                          frame="sm"
                          testid="maximize-timeline"
                          title="Maximize"
                          onClick={() => toggleMaximize("timeline")}
                          fontSize={theme.fontSize.sm}
                        >
                          ⊕
                        </IconButton>
                      }
                    />
                    <div style={{ flex: 1, overflow: "hidden" }}>{timeline}</div>
                  </section>
                </Panel>
              </PanelGroup>
            </Panel>

            <PanelResizeHandle style={{ ...resizeHandleStyle, display: panelVisible("inspector") ? undefined : "none" }} />
            {/* Inspector panel — right column; always mounted */}
            <Panel
              defaultSize={24}
              minSize={12}
              style={{ display: panelVisible("inspector") ? undefined : "none" }}
              onClick={() => handleFocus("inspector")}
            >
              <section data-testid="panel-inspector" style={panelStyle("inspector")}>
                <PanelHeader
                  title="Inspector"
                  trailing={
                    <IconButton
                      frame="sm"
                      testid="maximize-inspector"
                      title="Maximize"
                      onClick={() => toggleMaximize("inspector")}
                      fontSize={theme.fontSize.sm}
                    >
                      ⊕
                    </IconButton>
                  }
                />
                <div style={{ flex: 1, overflow: "hidden" }}>{inspector}</div>
              </section>
            </Panel>

            {agent && agentVisible && (
              <>
                <PanelResizeHandle style={resizeHandleStyle} />
                <Panel defaultSize={22} minSize={14}>
                  <section data-testid="panel-agent" style={panelSectionStyle}>
                    <PanelHeader title="Agent" />
                    <div style={{ flex: 1, overflow: "hidden" }}>{agent}</div>
                  </section>
                </Panel>
              </>
            )}
          </PanelGroup>
        </div>
      )}
    </div>
  );
}

function TopBar({ slot, title }: { slot?: ReactNode; title?: string }) {
  return (
    <div
      style={{
        height: theme.size.topBar,
        background: theme.bg.surface,
        borderBottom: `${theme.borderWidth.thin} solid ${theme.border.primary}`,
        display: "flex",
        alignItems: "center",
        padding: `0 ${theme.spacing.md}`,
        flexShrink: 0,
        gap: theme.spacing.sm,
      }}
    >
      {slot}
      <span
        data-testid="top-bar-title"
        style={{ fontSize: theme.fontSize.md, color: theme.text.primary, fontWeight: theme.fontWeight.semibold }}
      >
        {title ?? "Frontstage"}
      </span>
    </div>
  );
}
