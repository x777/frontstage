import type { EditorStore } from "@palmier/core";
import {
  splitAtPlayheadCommand,
  trimStartToPlayheadCommand,
  trimEndToPlayheadCommand,
  addTextClipAtPlayhead,
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_TOOLBAR_STEP,
} from "@palmier/core";
import { theme } from "../theme/theme.js";
import { Icon, IconButton } from "../primitives/index.js";
import { useStore } from "../store/use-store.js";

// ToolbarView.swift's toolbarButton/zoomButton render glyphs at FontSize.md/sm (13/11pt) inside a
// hardcoded 24x24 hit box. 14 is the package's established icon-px near that range (see
// TransportBar's TRANSPORT_ICON_SIZE) — one constant for every button here, per the design rule.
const TOOLBAR_ICON_SIZE = 14;

function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

function ToolbarDivider() {
  return <div style={{ width: 1, height: theme.spacing.xl, background: theme.border.subtle, flexShrink: 0 }} />;
}

export function Toolbar({ store }: { store: EditorStore }) {
  const snap = useStore(store, (s) => s);
  const { toolMode, playhead, selection, view, timeline } = snap;
  const zoom = view.zoom;

  function handleSplit() {
    store.dispatch(splitAtPlayheadCommand([...selection], playhead));
  }

  function handleTrimStart() {
    store.dispatch(trimStartToPlayheadCommand([...selection], playhead));
  }

  function handleTrimEnd() {
    store.dispatch(trimEndToPlayheadCommand([...selection], playhead));
  }

  function handleAddText() {
    const { command, clipId } = addTextClipAtPlayhead(playhead, timeline.fps);
    store.dispatch(command);
    store.select([clipId]);
  }

  function handleZoomOut() {
    store.setZoom(clampZoom(zoom / ZOOM_TOOLBAR_STEP));
  }

  function handleZoomIn() {
    store.setZoom(clampZoom(zoom * ZOOM_TOOLBAR_STEP));
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        height: theme.size.toolbar,
        flexShrink: 0,
        padding: `0 ${theme.spacing.md}`,
        gap: theme.spacing.md,
        background: theme.bg.surface,
        borderBottom: `${theme.borderWidth.hairline} solid ${theme.border.subtle}`,
      }}
    >
      <IconButton testid="toolbar-undo" title="Undo (⌘Z)" frame="mdLg" onClick={() => store.undo()}>
        <Icon name="undo" size={TOOLBAR_ICON_SIZE} />
      </IconButton>
      <IconButton testid="toolbar-redo" title="Redo (⇧⌘Z)" frame="mdLg" onClick={() => store.redo()}>
        <Icon name="redo" size={TOOLBAR_ICON_SIZE} />
      </IconButton>

      <ToolbarDivider />

      <IconButton
        testid="toolbar-pointer"
        title="Pointer (V)"
        frame="mdLg"
        tone="tertiary"
        active={toolMode === "pointer"}
        ariaPressed={toolMode === "pointer"}
        onClick={() => store.setToolMode("pointer")}
      >
        <Icon name="cursor" size={TOOLBAR_ICON_SIZE} />
      </IconButton>
      <IconButton
        testid="toolbar-razor"
        title="Razor (C)"
        frame="mdLg"
        tone="tertiary"
        active={toolMode === "razor"}
        ariaPressed={toolMode === "razor"}
        onClick={() => store.setToolMode("razor")}
      >
        <Icon name="scissors" size={TOOLBAR_ICON_SIZE} />
      </IconButton>

      <ToolbarDivider />

      <IconButton testid="toolbar-split" title="Split at Playhead (⌘K)" frame="mdLg" onClick={handleSplit}>
        <Icon name="split-clip" size={TOOLBAR_ICON_SIZE} />
      </IconButton>
      <IconButton testid="toolbar-trim-start" title="Trim Start to Playhead (Q)" frame="mdLg" onClick={handleTrimStart}>
        <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: theme.fontWeight.semibold, fontSize: theme.fontSize.toolbarBracket }}>
          [
        </span>
      </IconButton>
      <IconButton testid="toolbar-trim-end" title="Trim End to Playhead (W)" frame="mdLg" onClick={handleTrimEnd}>
        <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: theme.fontWeight.semibold, fontSize: theme.fontSize.toolbarBracket }}>
          ]
        </span>
      </IconButton>

      <ToolbarDivider />

      <IconButton testid="toolbar-add-text" title="Add Text" frame="mdLg" onClick={handleAddText}>
        <span style={{ fontFamily: "ui-serif, Georgia, serif", fontWeight: theme.fontWeight.bold, fontSize: theme.fontSize.toolbarTextGlyph }}>
          T
        </span>
      </IconButton>

      <div style={{ flex: 1 }} />

      <div style={{ display: "flex", alignItems: "center", gap: theme.spacing.xs }}>
        <IconButton
          testid="toolbar-zoom-out"
          title="Zoom Out"
          frame="mdLg"
          tone="tertiary"
          disabled={zoom <= ZOOM_MIN}
          onClick={handleZoomOut}
        >
          <Icon name="zoom-out" size={TOOLBAR_ICON_SIZE} />
        </IconButton>
        <input
          type="range"
          data-testid="toolbar-zoom-slider"
          min={Math.log(ZOOM_MIN)}
          max={Math.log(ZOOM_MAX)}
          step="any"
          value={Math.log(zoom)}
          onChange={(e) => store.setZoom(Math.exp(Number(e.target.value)))}
          style={{ accentColor: theme.accent.primary, width: theme.size.zoomSliderW }}
        />
        <IconButton
          testid="toolbar-zoom-in"
          title="Zoom In"
          frame="mdLg"
          tone="tertiary"
          disabled={zoom >= ZOOM_MAX}
          onClick={handleZoomIn}
        >
          <Icon name="zoom-in" size={TOOLBAR_ICON_SIZE} />
        </IconButton>
      </div>
    </div>
  );
}
