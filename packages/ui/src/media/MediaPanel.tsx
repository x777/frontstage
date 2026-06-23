import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import type { MediaManifestEntry } from "@palmier/core";
import { theme } from "../theme/theme.js";

interface MediaLibraryLike {
  getSnapshot(): { entries: MediaManifestEntry[] };
  subscribe(cb: () => void): () => void;
  thumbnail(id: string): string | undefined;
  importFiles(files: File[] | FileList): Promise<MediaManifestEntry[]>;
}

export interface MediaPanelProps {
  library: MediaLibraryLike;
  onItemPointerDown?: (entry: MediaManifestEntry, e: React.PointerEvent) => void;
}

export function MediaPanel({ library, onItemPointerDown }: MediaPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  const entries = useSyncExternalStore(
    library.subscribe.bind(library),
    () => library.getSnapshot().entries,
  );

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        library.importFiles(files).catch(() => {});
      }
      // Reset so re-selecting same file re-fires
      e.target.value = "";
    },
    [library],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        library.importFiles(files).catch(() => {});
      }
    },
    [library],
  );

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: theme.bg.surface,
        border: isDragOver
          ? `${theme.borderWidth.medium} solid ${theme.accent.primary}`
          : `${theme.borderWidth.hairline} solid transparent`,
        borderRadius: theme.radius.sm,
        boxSizing: "border-box",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: theme.spacing.xs,
          padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
          borderBottom: `${theme.borderWidth.hairline} solid ${theme.border.divider}`,
          flexShrink: 0,
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="video/*,image/*,audio/*"
          style={{ display: "none" }}
          onChange={handleFileChange}
        />
        <button
          data-testid="media-import"
          onClick={handleImportClick}
          style={{
            background: theme.bg.raised,
            color: theme.text.primary,
            border: `${theme.borderWidth.hairline} solid ${theme.border.primary}`,
            borderRadius: theme.radius.xs,
            padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
            fontSize: theme.fontSize.xs,
            fontWeight: theme.fontWeight.medium,
            cursor: "pointer",
          }}
        >
          Import
        </button>
        <input
          data-testid="media-search"
          type="text"
          disabled
          placeholder="Search"
          style={{
            flex: 1,
            background: theme.bg.base,
            color: theme.text.muted,
            border: `${theme.borderWidth.hairline} solid ${theme.border.subtle}`,
            borderRadius: theme.radius.xs,
            padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
            fontSize: theme.fontSize.xs,
            outline: "none",
          }}
        />
      </div>

      {/* Grid */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: theme.spacing.xs,
          display: "grid",
          gridTemplateColumns: `repeat(auto-fill, minmax(${theme.size.mediaItemMin}, 1fr))`,
          gap: theme.spacing.xs,
          alignContent: "start",
        }}
      >
        {entries.map((entry) => (
          <MediaItem
            key={entry.id}
            entry={entry}
            thumbnail={library.thumbnail(entry.id)}
            onPointerDown={onItemPointerDown}
          />
        ))}
      </div>
    </div>
  );
}

interface MediaItemProps {
  entry: MediaManifestEntry;
  thumbnail: string | undefined;
  onPointerDown?: (entry: MediaManifestEntry, e: React.PointerEvent) => void;
}

function MediaItem({ entry, thumbnail, onPointerDown }: MediaItemProps) {
  const trackColor = theme.track[entry.type as keyof typeof theme.track] ?? theme.bg.prominent;

  return (
    <div
      data-testid="media-item"
      data-media-id={entry.id}
      onPointerDown={(e) => onPointerDown?.(entry, e)}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: theme.spacing.xxs,
        cursor: "default",
        borderRadius: theme.radius.xs,
        overflow: "hidden",
        background: theme.bg.raised,
        border: `${theme.borderWidth.hairline} solid ${theme.border.subtle}`,
      }}
    >
      {/* Thumbnail or color tile */}
      <div
        style={{
          width: "100%",
          aspectRatio: "16/9",
          background: thumbnail ? "transparent" : trackColor,
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {thumbnail ? (
          <img
            src={thumbnail}
            alt={entry.name}
            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
          />
        ) : null}
      </div>

      {/* Name + badge */}
      <div
        style={{
          padding: `0 ${theme.spacing.xxs} ${theme.spacing.xxs}`,
          display: "flex",
          flexDirection: "column",
          gap: theme.spacing.xxs,
        }}
      >
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
          {entry.name}
        </span>
        <span
          style={{
            fontSize: theme.fontSize.micro,
            color: theme.text.muted,
            background: trackColor,
            borderRadius: theme.radius.xs,
            padding: `0 ${theme.spacing.xxs}`,
            alignSelf: "flex-start",
            textTransform: "uppercase",
            letterSpacing: theme.letterSpacing.wide,
          }}
        >
          {entry.type}
        </span>
      </div>
    </div>
  );
}
