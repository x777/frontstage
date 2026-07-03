import { useState } from "react";
import type { MediaFolder } from "@palmier/core";
import { buildFolderIndex, folderPath } from "@palmier/core";
import { theme } from "../theme/theme.js";
import { isMediaDrag, readMediaDragPayload, type MediaDragPayload } from "./FolderTile.js";

export interface MediaBreadcrumbsProps {
  folders: MediaFolder[];
  currentFolderId: string | undefined;
  onNavigate: (folderId: string | undefined) => void;
  onDropOn: (folderId: string | undefined, payload: MediaDragPayload) => void;
}

interface BreadcrumbItem {
  id: string | undefined;
  name: string;
}

export function MediaBreadcrumbs({ folders, currentFolderId, onNavigate, onDropOn }: MediaBreadcrumbsProps) {
  const index = buildFolderIndex(folders);
  const path = folderPath(index, currentFolderId);
  const items: BreadcrumbItem[] = [{ id: undefined, name: "Library" }, ...path.map((f) => ({ id: f.id, name: f.name }))];

  return (
    <div
      data-testid="media-breadcrumbs"
      style={{
        display: "flex",
        alignItems: "center",
        gap: theme.spacing.xxs,
        padding: `${theme.spacing.xxs} ${theme.spacing.sm}`,
        overflowX: "auto",
        flexShrink: 0,
        borderBottom: `${theme.borderWidth.hairline} solid ${theme.border.divider}`,
      }}
    >
      {items.map((item, idx) => {
        const isLeaf = idx === items.length - 1;
        return (
          <span key={item.id ?? "__root__"} style={{ display: "flex", alignItems: "center", gap: theme.spacing.xxs }}>
            {idx > 0 && (
              <span style={{ color: theme.text.muted, fontSize: theme.fontSize.xxs }} aria-hidden="true">
                {"›"}
              </span>
            )}
            <BreadcrumbChip item={item} isLeaf={isLeaf} onNavigate={onNavigate} onDropOn={onDropOn} />
          </span>
        );
      })}
    </div>
  );
}

function BreadcrumbChip({
  item,
  isLeaf,
  onNavigate,
  onDropOn,
}: {
  item: BreadcrumbItem;
  isLeaf: boolean;
  onNavigate: (id: string | undefined) => void;
  onDropOn: (id: string | undefined, payload: MediaDragPayload) => void;
}) {
  const [isDropHover, setIsDropHover] = useState(false);

  return (
    <button
      data-testid={`media-breadcrumb-${item.id ?? "root"}`}
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
        background: isDropHover ? theme.accent.primary : "transparent",
        color: isDropHover ? theme.text.onAccent : isLeaf ? theme.text.primary : theme.text.tertiary,
        border: "none",
        borderRadius: theme.radius.xs,
        padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
        fontSize: theme.fontSize.xs,
        fontWeight: isLeaf ? theme.fontWeight.semibold : theme.fontWeight.regular,
        cursor: isLeaf ? "default" : "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {item.name}
    </button>
  );
}
