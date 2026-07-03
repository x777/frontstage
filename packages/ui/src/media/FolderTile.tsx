import { useEffect, useState } from "react";
import type { MediaFolder } from "@palmier/core";
import { theme } from "../theme/theme.js";

export const MEDIA_DRAG_MIME = "application/x-palmier-media";

// `data-folder-drop` value for the root "Library" chip — folder ids are never this string.
export const FOLDER_DROP_ROOT = "__root__";

export interface MediaDragPayload {
  kind: "asset" | "folder";
  id: string;
}

export function setMediaDragPayload(e: React.DragEvent, payload: MediaDragPayload): void {
  e.dataTransfer.setData(MEDIA_DRAG_MIME, JSON.stringify(payload));
  e.dataTransfer.effectAllowed = "move";
}

// dragover/dragenter may only see `types` (browsers hide `getData` until drop) — that's enough to
// decide "is this an internal move" without touching the OS file-drop path.
export function isMediaDrag(e: React.DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes(MEDIA_DRAG_MIME);
}

export function readMediaDragPayload(e: React.DragEvent): MediaDragPayload | null {
  if (!isMediaDrag(e)) return null;
  try {
    const raw = e.dataTransfer.getData(MEDIA_DRAG_MIME);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MediaDragPayload>;
    if ((parsed.kind !== "asset" && parsed.kind !== "folder") || typeof parsed.id !== "string") return null;
    return { kind: parsed.kind, id: parsed.id };
  } catch {
    return null;
  }
}

export interface FolderTileProps {
  folder: MediaFolder;
  childCount: number;
  isSelected: boolean;
  isRenaming: boolean;
  // True while the custom pointer-drag (asset tile dragged via MediaDragController) hovers
  // this tile — drives the same hover styling as the native onDragOver path.
  dragOverActive?: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onRenameStart: () => void;
  onRenameCommit: (name: string) => void;
  onRenameCancel: () => void;
  onDelete: () => void;
  onDropPayload: (payload: MediaDragPayload) => void;
}

export function FolderTile({
  folder,
  childCount,
  isSelected,
  isRenaming,
  dragOverActive = false,
  onSelect,
  onOpen,
  onRenameStart,
  onRenameCommit,
  onRenameCancel,
  onDelete,
  onDropPayload,
}: FolderTileProps) {
  const [isDropHover, setIsDropHover] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [draft, setDraft] = useState(folder.name);

  useEffect(() => {
    if (isRenaming) setDraft(folder.name);
  }, [isRenaming, folder.name]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menuOpen]);

  const commitRename = () => {
    const trimmed = draft.trim();
    if (trimmed === "" || trimmed === folder.name) {
      onRenameCancel();
    } else {
      onRenameCommit(trimmed);
    }
  };

  const isDropActive = isDropHover || dragOverActive;
  const highlighted = isDropActive || isSelected;

  return (
    <div
      data-testid="folder-tile"
      data-folder-id={folder.id}
      data-folder-drop={folder.id}
      data-drop-active={isDropActive ? "true" : undefined}
      aria-label={`Folder ${folder.name}`}
      draggable
      onDragStart={(e) => setMediaDragPayload(e, { kind: "folder", id: folder.id })}
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
        onDropPayload(payload);
      }}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onContextMenu={(e) => {
        e.preventDefault();
        setMenuOpen(true);
      }}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        gap: theme.spacing.xxs,
        cursor: "default",
        borderRadius: theme.radius.xs,
        background: theme.bg.raised,
        border: `${highlighted ? theme.borderWidth.thick : theme.borderWidth.hairline} solid ${
          highlighted ? theme.accent.primary : theme.border.subtle
        }`,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "16/9",
          background: theme.folder.tileBg,
          borderRadius: theme.radius.xs,
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: theme.fontSize.display, color: theme.folder.icon }}>{"📁"}</span>
        {childCount > 0 && (
          <span
            data-testid="folder-child-count"
            style={{
              position: "absolute",
              top: theme.spacing.xs,
              right: theme.spacing.xs,
              background: theme.folder.badgeBg,
              color: theme.folder.badgeText,
              fontSize: theme.fontSize.xxs,
              fontWeight: theme.fontWeight.semibold,
              borderRadius: theme.radius.xl,
              padding: `0 ${theme.spacing.xs}`,
            }}
          >
            {childCount}
          </span>
        )}
      </div>

      <div style={{ padding: `0 ${theme.spacing.xxs} ${theme.spacing.xxs}` }}>
        {isRenaming ? (
          <input
            data-testid="folder-rename-input"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") onRenameCancel();
            }}
            style={{
              width: "100%",
              boxSizing: "border-box",
              fontSize: theme.fontSize.micro,
              fontWeight: theme.fontWeight.medium,
              color: theme.text.primary,
              background: theme.bg.base,
              border: `${theme.borderWidth.hairline} solid ${theme.border.primary}`,
              borderRadius: theme.radius.xs,
              padding: `0 ${theme.spacing.xxs}`,
            }}
          />
        ) : (
          <span
            style={{
              fontSize: theme.fontSize.micro,
              color: theme.text.primary,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              display: "block",
            }}
          >
            {folder.name}
          </span>
        )}
      </div>

      {menuOpen && (
        <div
          data-testid="folder-context-menu"
          role="menu"
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            top: theme.spacing.xs,
            right: theme.spacing.xs,
            zIndex: theme.z.menu,
            background: theme.bg.raised,
            border: `${theme.borderWidth.hairline} solid ${theme.border.divider}`,
            borderRadius: theme.radius.sm,
            padding: theme.spacing.xxs,
            minWidth: theme.size.menuMin,
            boxShadow: theme.shadow.lg,
          }}
        >
          <MenuItem testid="folder-menu-open" label="Open" onClick={() => { setMenuOpen(false); onOpen(); }} />
          <MenuItem testid="folder-menu-rename" label="Rename" onClick={() => { setMenuOpen(false); onRenameStart(); }} />
          <div style={{ borderTop: `${theme.borderWidth.hairline} solid ${theme.border.divider}`, margin: `${theme.spacing.xxs} 0` }} />
          <MenuItem testid="folder-menu-delete" label="Delete" danger onClick={() => { setMenuOpen(false); onDelete(); }} />
        </div>
      )}
    </div>
  );
}

function MenuItem({ testid, label, onClick, danger }: { testid: string; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      data-testid={testid}
      onClick={onClick}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        border: "none",
        background: "transparent",
        color: danger ? theme.status.error : theme.text.primary,
        cursor: "pointer",
        padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
        fontSize: theme.fontSize.sm,
      }}
    >
      {label}
    </button>
  );
}
