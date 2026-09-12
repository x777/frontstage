import { useEffect, useRef, useState } from "react";
import type { CanvasFormatKind, CanvasGridOverlay, CanvasGuideKind, CanvasOverlaySelection } from "@frontstage/core";
import {
  CANVAS_FORMAT_KINDS,
  CANVAS_FORMAT_LABEL,
  CANVAS_GRID_PRESETS,
  CANVAS_GUIDE_KINDS,
  canvasOverlayIsEmpty,
  clearCanvasOverlaySelection,
} from "@frontstage/core";
import { theme } from "../theme/theme.js";
import { Icon, IconButton, MenuList } from "../primitives/index.js";
import type { MenuListItem } from "../primitives/index.js";

const GUIDE_LABEL: Record<CanvasGuideKind, string> = {
  actionSafe: "Action Safe",
  titleSafe: "Title Safe",
  center: "Center",
};

interface CanvasGuidesMenuProps {
  selection: CanvasOverlaySelection;
  onChange: (next: CanvasOverlaySelection) => void;
}

export function CanvasGuidesMenu({ selection, onChange }: CanvasGuidesMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const active = !canvasOverlayIsEmpty(selection);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  function mark(label: string, selected: boolean): string {
    return selected ? `✓ ${label}` : label;
  }

  const items: MenuListItem[] = [
    { id: "hdr-grid", label: "Grid", header: true },
    { id: "grid-none", label: mark("None", selection.grid === undefined) },
    ...CANVAS_GRID_PRESETS.map((g) => ({
      id: `grid-${g}`,
      label: mark(`${g} × ${g}`, selection.grid === g),
      separatorBefore: g === 2,
    })),
    { id: "hdr-safe", label: "Safe Zones", header: true },
    ...CANVAS_GUIDE_KINDS.map((g) => ({
      id: `guide-${g}`,
      label: mark(GUIDE_LABEL[g], selection.guides.has(g)),
    })),
    { id: "hdr-fmt", label: "Format References", header: true },
    { id: "fmt-none", label: mark("None", selection.format === undefined) },
    ...CANVAS_FORMAT_KINDS.map((f, i) => ({
      id: `fmt-${f}`,
      label: mark(CANVAS_FORMAT_LABEL[f], selection.format === f),
      separatorBefore: i === 0,
    })),
    {
      id: "hide",
      label: "Hide Guides",
      separatorBefore: true,
      disabled: !active,
    },
  ];

  function onSelect(id: string) {
    if (id === "hide") {
      onChange(clearCanvasOverlaySelection());
      return;
    }
    if (id === "grid-none") {
      onChange({ ...selection, grid: undefined });
      return;
    }
    if (id.startsWith("grid-")) {
      onChange({ ...selection, grid: Number(id.slice("grid-".length)) as CanvasGridOverlay });
      return;
    }
    if (id.startsWith("guide-")) {
      const kind = id.slice("guide-".length) as CanvasGuideKind;
      const next = new Set(selection.guides);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      onChange({ ...selection, guides: next });
      return;
    }
    if (id === "fmt-none") {
      onChange({ ...selection, format: undefined });
      return;
    }
    if (id.startsWith("fmt-")) {
      onChange({ ...selection, format: id.slice("fmt-".length) as CanvasFormatKind });
    }
  }

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <IconButton
        title="Canvas Guides"
        testid="canvas-guides-button"
        active={active}
        ariaPressed={active}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="viewfinder" size={theme.iconSize.sm} />
      </IconButton>
      {open && (
        <div
          data-testid="canvas-guides-menu"
          style={{ position: "absolute", top: "100%", right: 0, zIndex: 20 }}
        >
          <MenuList items={items} onSelect={onSelect} testid="canvas-guides-menu-list" />
        </div>
      )}
    </div>
  );
}
