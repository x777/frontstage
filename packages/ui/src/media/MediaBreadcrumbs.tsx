import { useState } from "react";
import type { MediaFolder } from "@palmier/core";
import { buildFolderIndex, folderPath } from "@palmier/core";
import { theme } from "../theme/theme.js";
import { Icon } from "../primitives/index.js";
import { FOLDER_DROP_ROOT, isMediaDrag, readMediaDragPayload, type MediaDragPayload } from "./FolderTile.js";

// Mirrors --font-xs (10px) — MediaTab.swift:346-348 sizes the chevron via .font(), not IconSize.
const CRUMB_CHEVRON_SIZE = 10;

export interface MediaBreadcrumbsProps {
  folders: MediaFolder[];
  currentFolderId: string | undefined;
  onNavigate: (folderId: string | undefined) => void;
  onDropOn: (folderId: string | undefined, payload: MediaDragPayload) => void;
  // `data-folder-drop` id currently hovered by the custom pointer-drag, or null/undefined.
  dragOverFolderId?: string | null;
  // Subfolder + asset count of the current folder — rendered trailing, muted xs (MediaTab.swift
  // itemCountText). Omitted -> no count shown.
  itemCount?: number;
}

interface BreadcrumbItem {
  id: string | undefined;
  name: string;
}

export function MediaBreadcrumbs({ folders, currentFolderId, onNavigate, onDropOn, dragOverFolderId, itemCount }: MediaBreadcrumbsProps) {
  const index = buildFolderIndex(folders);
  const path = folderPath(index, currentFolderId);
  const items: BreadcrumbItem[] = [{ id: undefined, name: "Library" }, ...path.map((f) => ({ id: f.id, name: f.name }))];

  return (
    <div
      data-testid="media-breadcrumbs"
      style={{
        display: "flex",
        alignItems: "center",
        gap: theme.spacing.xs,
        height: theme.iconSize.md,
        boxSizing: "border-box",
        padding: `0 ${theme.spacing.sm}`,
        flexShrink: 0,
        borderBottom: `${theme.borderWidth.hairline} solid ${theme.border.divider}`,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: theme.spacing.xxs,
          overflowX: "auto",
          flex: 1,
          minWidth: 0,
        }}
      >
        {items.map((item, idx) => {
          const isLeaf = idx === items.length - 1;
          return (
            <span key={item.id ?? "__root__"} style={{ display: "flex", alignItems: "center", gap: theme.spacing.xxs }}>
              {idx > 0 && (
                <span style={{ display: "flex", color: theme.text.muted }} aria-hidden="true">
                  <Icon name="chevron-right" size={CRUMB_CHEVRON_SIZE} />
                </span>
              )}
              <BreadcrumbChip
                item={item}
                isLeaf={isLeaf}
                // The root "Library" crumb, when it's the current position (i.e. at root), reads
                // as a heading rather than a link — matches Swift's grouped-section-header caption
                // (MediaTab+Grids.swift groupedSectionTitle, single-segment case: sm/semibold/
                // primary — not the xs/tertiary "Library" gets as a plain ancestor crumb).
                isRootLeaf={idx === 0 && isLeaf}
                onNavigate={onNavigate}
                onDropOn={onDropOn}
                dragOverActive={(item.id ?? FOLDER_DROP_ROOT) === dragOverFolderId}
              />
            </span>
          );
        })}
      </div>
      {itemCount !== undefined && (
        <span
          style={{
            fontSize: theme.fontSize.xs,
            color: theme.text.muted,
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
        >
          {itemCount === 1 ? "1 item" : `${itemCount} items`}
        </span>
      )}
    </div>
  );
}

function BreadcrumbChip({
  item,
  isLeaf,
  isRootLeaf,
  onNavigate,
  onDropOn,
  dragOverActive,
}: {
  item: BreadcrumbItem;
  isLeaf: boolean;
  isRootLeaf: boolean;
  onNavigate: (id: string | undefined) => void;
  onDropOn: (id: string | undefined, payload: MediaDragPayload) => void;
  // True while the custom pointer-drag (asset tile) hovers this chip.
  dragOverActive: boolean;
}) {
  const [isDropHover, setIsDropHover] = useState(false);
  const isDropActive = isDropHover || dragOverActive;

  return (
    <button
      data-testid={`media-breadcrumb-${item.id ?? "root"}`}
      data-folder-drop={item.id ?? FOLDER_DROP_ROOT}
      data-drop-active={isDropActive ? "true" : undefined}
      onClick={() => {
        if (!isLeaf) onNavigate(item.id);
      }}
      onDragOver={(e) => {
        if (!isMediaDrag(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setIsDropHover(true);
      }}
      onDragLeave={() => setIsDropHover(false)}
      onDrop={(e) => {
        setIsDropHover(false);
        const payload = readMediaDragPayload(e);
        if (!payload) return;
        e.preventDefault();
        e.stopPropagation();
        onDropOn(item.id, payload);
      }}
      style={{
        background: isDropActive ? theme.accent.primary : "transparent",
        color: isDropActive ? theme.text.onAccent : isLeaf ? theme.text.primary : theme.text.tertiary,
        border: "none",
        borderRadius: theme.radius.xs,
        padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
        fontSize: isRootLeaf ? theme.fontSize.sm : theme.fontSize.xs,
        fontWeight: isLeaf ? theme.fontWeight.semibold : theme.fontWeight.regular,
        cursor: isLeaf ? "default" : "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {item.name}
    </button>
  );
}
