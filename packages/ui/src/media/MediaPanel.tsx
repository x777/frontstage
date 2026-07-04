import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { EditorStore, MediaFolder, MediaManifestEntry } from "@palmier/core";
import { buildFolderIndex, collectFolderCascade, folderPath, parseGenerationStatus } from "@palmier/core";
import { theme } from "../theme/theme.js";
import { Button, Icon, IconButton, MenuList, SearchField } from "../primitives/index.js";
import type { IconName, MenuListItem } from "../primitives/index.js";
import { GeneratingOverlay, generatingLabel } from "./GeneratingOverlay.js";
import { CaptionsTab } from "./CaptionsTab.js";
import type { CaptionsExecutor, CaptionsTranscriptionFacade } from "./CaptionsTab.js";
import { FolderTile, isMediaDrag, type MediaDragPayload } from "./FolderTile.js";
import { MediaBreadcrumbs } from "./MediaBreadcrumbs.js";
import { MatteSheet } from "./MatteSheet.js";
import type { IndexStatus, MissingModel } from "./media-indexing.js";

const MODEL_LABEL: Record<MissingModel, string> = { embedding: "Search model", transcription: "Transcription model" };
// Downloaded in this fixed order regardless of Set iteration order — embedding is the older/
// larger download, so it leads.
const MODEL_DOWNLOAD_ORDER: MissingModel[] = ["embedding", "transcription"];

export interface MediaIndexingFacade {
  getStatus(): IndexStatus;
  subscribe(cb: () => void): () => void;
  // Downloads the search-embedding model (M12C T4's confirm-gate action, surfaced here too so the
  // panel doesn't require going through the agent). Omitted -> not offered by the Download button.
  ensureEmbeddingReady?: (onProgress?: (p: { loaded: number; total: number }) => void) => Promise<void>;
  // Downloads the local-transcription model (M14A T3), same shape. Omitted -> not offered either.
  ensureAsrReady?: (onProgress?: (p: { loaded: number; total: number }) => void) => Promise<void>;
}

const IDLE_STATUS: IndexStatus = { kind: "idle" };
const noopSubscribe = () => () => {};

// Swift MediaTab+IndexStatus spirit: a compact line, nothing while idle.
function indexStatusLabel(status: IndexStatus): string | null {
  if (status.kind === "indexing") return `Indexing ${Math.min(status.done + 1, status.total)} of ${status.total}…`;
  if (status.kind === "waiting-model") return `Waiting for ${status.missing.map((m) => MODEL_LABEL[m]).join(", ")}`;
  return null;
}

interface MediaLibraryLike {
  getSnapshot(): { entries: MediaManifestEntry[]; folders: MediaFolder[] };
  subscribe(cb: () => void): () => void;
  thumbnail(id: string): string | undefined;
  importFiles(files: File[] | FileList, folderId?: string): Promise<MediaManifestEntry[]>;
  entry(id: string): MediaManifestEntry | undefined;
  createFolder(name: string, parentFolderId?: string): MediaFolder;
  renameFolder(folderId: string, name: string): void;
  deleteFolders(folderIds: string[]): { removedAssetIds: string[] };
  moveEntriesToFolder(assetIds: string[], folderId: string | undefined): void;
  moveFolderToFolder(folderId: string, targetId: string | undefined): void;
  // Backs the "New Matte…" header action (M13A T1) — the SAME fromBytes-backed import path
  // import_media uses. Optional: omitted -> the action is hidden rather than erroring.
  importBytes?(bytes: Uint8Array, mimeType: string, name?: string, folderId?: string): Promise<{ assetId: string }>;
}

export interface MediaPanelProps {
  library: MediaLibraryLike;
  onItemPointerDown?: (entry: MediaManifestEntry, e: React.PointerEvent) => void;
  store?: EditorStore;
  executor?: CaptionsExecutor;
  transcription?: CaptionsTranscriptionFacade;
  indexing?: MediaIndexingFacade;
  // `data-folder-drop` id currently hovered by the custom pointer-drag (asset tile dragged
  // toward the timeline, per onItemPointerDown), driven by the host (Editor). Only relevant
  // while that gesture is active — drives FolderTile/MediaBreadcrumbs hover styling for it.
  dragOverFolderId?: string | null;
}

type PanelTab = "media" | "captions";

// Swift's PanelTab has a third case (.music) — deliberately unported here (recorded deviation).
const MEDIA_PANEL_TABS: { id: PanelTab; label: string; icon: IconName }[] = [
  { id: "media", label: "Media", icon: "folder" },
  { id: "captions", label: "Captions", icon: "captions" },
];
// Mirrors --icon-size-sm (18px) — Icon's size prop sets raw SVG width/height, not a CSS var.
const TAB_ICON_SIZE = 18;
// Mirrors --font-xs (10px) — MediaTab.swift's toolbarButton/toolbarMenuIcon glyphs are sized via
// the ambient .font(), not IconSize; the overflow trigger's own frame is --icon-size-sm (18px).
const HEADER_ICON_SIZE = 10;
const OVERFLOW_ICON_FRAME = "sm" as const;

export function MediaPanel({ library, onItemPointerDown, store, executor, transcription, indexing, dragOverFolderId }: MediaPanelProps) {
  const indexStatus = useSyncExternalStore(
    indexing?.subscribe ?? noopSubscribe,
    () => indexing?.getStatus() ?? IDLE_STATUS,
  );
  const indexLabel = indexStatusLabel(indexStatus);
  // Which of the two missing models is downloading right now — null while idle. Drives the button
  // label/disabled state; the models download strictly one after the other, never in parallel.
  const [downloadingModel, setDownloadingModel] = useState<MissingModel | null>(null);
  const ensureFor = useCallback(
    (model: MissingModel) => (model === "embedding" ? indexing?.ensureEmbeddingReady : indexing?.ensureAsrReady),
    [indexing],
  );
  const handleDownloadModels = useCallback(() => {
    if (downloadingModel || indexStatus.kind !== "waiting-model") return;
    const targets = MODEL_DOWNLOAD_ORDER.filter((m) => indexStatus.missing.includes(m) && ensureFor(m) != null);
    const [first, ...rest] = targets;
    if (first === undefined) return;
    // The first download starts synchronously in this click handler (matching the M12C single-model
    // precedent); later ones chain via .then() once the prior one settles — never in parallel.
    setDownloadingModel(first);
    let chain = ensureFor(first)!().catch(() => {});
    for (const model of rest) {
      chain = chain.then(() => {
        setDownloadingModel(model);
        return ensureFor(model)!().catch(() => {});
      });
    }
    void chain.finally(() => setDownloadingModel(null));
  }, [downloadingModel, indexStatus, ensureFor]);
  const downloadableMissing =
    indexStatus.kind === "waiting-model" ? indexStatus.missing.filter((m) => ensureFor(m) != null) : [];
  // Two independent primitive selectors (not one object-returning selector — see the entries/
  // folders comment below) so an absent store falls back to a stable default without needing a
  // conditional hook call.
  const timelineWidth = useSyncExternalStore(
    store?.subscribe.bind(store) ?? noopSubscribe,
    () => store?.getSnapshot().timeline.width ?? 1920,
  );
  const timelineHeight = useSyncExternalStore(
    store?.subscribe.bind(store) ?? noopSubscribe,
    () => store?.getSnapshot().timeline.height ?? 1080,
  );
  const [showMatteSheet, setShowMatteSheet] = useState(false);
  const canCreateMatte = library.importBytes !== undefined && store !== undefined;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [tab, setTab] = useState<PanelTab>("media");
  const [hoveredTab, setHoveredTab] = useState<PanelTab | null>(null);
  const [currentFolderId, setCurrentFolderId] = useState<string | undefined>(undefined);
  const [selectedFolderId, setSelectedFolderId] = useState<string | undefined>(undefined);
  const [renamingFolderId, setRenamingFolderId] = useState<string | undefined>(undefined);
  const [folderError, setFolderError] = useState<string | null>(null);
  // The Search input is a disabled placeholder (no search feature wired yet, same as before this
  // task) — kept controlled only because the kit SearchField requires value/onChange.
  const [searchQuery, setSearchQuery] = useState("");
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowMenuRef = useRef<HTMLDivElement>(null);

  // Two independent selectors (not one object-returning selector) so a host whose getSnapshot()
  // builds a fresh wrapper each call still gets stable per-field identity — useSyncExternalStore
  // requires Object.is-stable snapshots between renders or it loops.
  const entries = useSyncExternalStore(library.subscribe.bind(library), () => library.getSnapshot().entries);
  const folders = useSyncExternalStore(library.subscribe.bind(library), () => library.getSnapshot().folders);

  const childFolders = useMemo(
    () =>
      folders
        .filter((f) => (f.parentFolderId ?? undefined) === currentFolderId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [folders, currentFolderId],
  );
  const visibleEntries = useMemo(
    () => entries.filter((e) => (e.folderId ?? undefined) === currentFolderId),
    [entries, currentFolderId],
  );
  const childCount = useCallback(
    (folderId: string) =>
      folders.filter((f) => f.parentFolderId === folderId).length +
      entries.filter((e) => e.folderId === folderId).length,
    [folders, entries],
  );

  const navigateTo = useCallback((folderId: string | undefined) => {
    setCurrentFolderId(folderId);
    setSelectedFolderId(undefined);
    setFolderError(null);
  }, []);

  const folderIndex = useMemo(() => buildFolderIndex(folders), [folders]);

  // Remembers the ancestor chain for currentFolderId while it still resolves, so if the drilled-in
  // folder disappears out from under the panel (e.g. an agent's delete_folder over MCP), the reset
  // effect below can land on the nearest surviving ancestor instead of a dangling id. Written
  // during render (not an effect) so it always holds the last-valid path, not a stale one.
  const lastKnownPathRef = useRef<MediaFolder[]>([]);
  if (currentFolderId !== undefined && folderIndex.byId.has(currentFolderId)) {
    lastKnownPathRef.current = folderPath(folderIndex, currentFolderId);
  }

  // currentFolderId can go stale between renders. Without this, "New Folder" throws (createFolder
  // rejects an unknown parent) and OS-file-drop imports would stamp entries with a dangling
  // folderId that vanish from every view.
  useEffect(() => {
    if (currentFolderId === undefined || folderIndex.byId.has(currentFolderId)) return;
    const survivingAncestor = [...lastKnownPathRef.current].reverse().find((f) => folderIndex.byId.has(f.id));
    navigateTo(survivingAncestor?.id);
  }, [folderIndex, currentFolderId, navigateTo]);

  const createFolderAt = useCallback(
    (parentFolderId: string | undefined) => {
      const folder = library.createFolder("New Folder", parentFolderId);
      setFolderError(null);
      setSelectedFolderId(folder.id);
      setRenamingFolderId(folder.id);
    },
    [library],
  );

  const handleNewFolder = useCallback(() => {
    try {
      createFolderAt(currentFolderId);
    } catch {
      // currentFolderId is a dangling id (e.g. the reactive reset above hasn't landed yet) —
      // belt-and-braces: fall back to root rather than silently doing nothing.
      try {
        createFolderAt(undefined);
      } catch (err) {
        setFolderError(err instanceof Error ? err.message : String(err));
      }
    }
  }, [createFolderAt, currentFolderId]);

  // Overflow "⋯" menu (MediaTab.swift overflowMenu): New Folder / New Matte… moved off the
  // toolbar and into here, same testids/handlers as the standalone buttons they replaced.
  const overflowItems = useMemo<MenuListItem[]>(() => {
    const items: MenuListItem[] = [{ id: "new-folder", label: "New Folder", testid: "media-new-folder" }];
    if (canCreateMatte) items.push({ id: "new-matte", label: "New Matte…", testid: "media-new-matte" });
    return items;
  }, [canCreateMatte]);

  const handleOverflowSelect = useCallback(
    (id: string) => {
      setOverflowOpen(false);
      if (id === "new-folder") handleNewFolder();
      else if (id === "new-matte") setShowMatteSheet(true);
    },
    [handleNewFolder],
  );

  // Close on outside click — same idiom as FileMenu.tsx.
  useEffect(() => {
    if (!overflowOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (overflowMenuRef.current && !overflowMenuRef.current.contains(e.target as Node)) {
        setOverflowOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [overflowOpen]);

  const handleDropOnFolder = useCallback(
    (folderId: string | undefined, payload: MediaDragPayload) => {
      if (payload.kind === "asset") {
        library.moveEntriesToFolder([payload.id], folderId);
        return;
      }
      if (payload.id === folderId) return;
      try {
        library.moveFolderToFolder(payload.id, folderId);
      } catch {
        // invalid move (self/descendant/unknown target) — silently no-op
      }
    },
    [library],
  );

  const handleDeleteFolder = useCallback(
    (folder: MediaFolder) => {
      const cascade = collectFolderCascade(folders, entries, [folder.id]);
      const insideCount = cascade.folderIds.size - 1 + cascade.assetIds.size;
      if (!window.confirm(`Delete "${folder.name}"? Deletes ${insideCount} items inside.`)) return;
      library.deleteFolders([folder.id]);
      if (currentFolderId === folder.id) navigateTo(folder.parentFolderId);
    },
    [folders, entries, library, currentFolderId, navigateTo],
  );

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        library.importFiles(files, currentFolderId).catch(() => {});
      }
      // Reset so re-selecting same file re-fires
      e.target.value = "";
    },
    [library, currentFolderId],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!isMediaDrag(e)) setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      setIsDragOver(false);
      // Internal asset/folder moves carry the custom mime and are handled by their own drop
      // target (FolderTile/breadcrumb) — this only imports real OS files.
      if (isMediaDrag(e)) return;
      e.preventDefault();
      const files = e.dataTransfer.files;
      if (files && files.length > 0) {
        library.importFiles(files, currentFolderId).catch(() => {});
      }
    },
    [library, currentFolderId],
  );

  return (
    <div
      data-testid="media-panel"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        display: "flex",
        flexDirection: "row",
        height: "100%",
        background: theme.bg.surface,
        border: isDragOver
          ? `${theme.borderWidth.medium} solid ${theme.accent.primary}`
          : `${theme.borderWidth.hairline} solid transparent`,
        borderRadius: theme.radius.sm,
        boxSizing: "border-box",
      }}
    >
      {/* Tab rail — vertical icon column (MediaPanelView.swift panelTabRail) */}
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          gap: theme.spacing.xs,
          width: theme.size.mediaTabRail,
          flexShrink: 0,
          padding: theme.spacing.sm,
          background: theme.bg.raised,
          borderRight: `${theme.borderWidth.hairline} solid ${theme.border.primary}`,
          boxSizing: "border-box",
        }}
      >
        {MEDIA_PANEL_TABS.map((t) => {
          const selected = tab === t.id;
          return (
            <div
              key={t.id}
              style={{ position: "relative" }}
              onMouseEnter={() => setHoveredTab(t.id)}
              onMouseLeave={() => setHoveredTab((h) => (h === t.id ? null : h))}
            >
              <IconButton
                frame="lg"
                active={selected}
                ariaPressed={selected}
                testid={`media-tab-${t.id}`}
                title={t.label}
                onClick={() => setTab(t.id)}
              >
                <Icon name={t.icon} size={TAB_ICON_SIZE} />
              </IconButton>
              {selected && (
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: "50%",
                    transform: "translateY(-50%)",
                    width: theme.borderWidth.thick,
                    height: theme.iconSize.sm,
                    background: theme.border.primary,
                    borderRadius: theme.radius.pill,
                    pointerEvents: "none",
                  }}
                />
              )}
            </div>
          );
        })}
        {MEDIA_PANEL_TABS.map((t, i) => (
          <div
            key={`hover-${t.id}`}
            style={{
              position: "absolute",
              left: `calc(${theme.size.mediaTabRail} + ${theme.spacing.xs})`,
              top: `calc(${theme.spacing.sm} + ${i} * (${theme.iconSize.lg} + ${theme.spacing.xs}))`,
              display: "flex",
              alignItems: "center",
              height: theme.iconSize.lg,
              padding: `0 ${theme.spacing.smMd}`,
              fontSize: theme.fontSize.xs,
              fontWeight: theme.fontWeight.medium,
              color: theme.text.primary,
              whiteSpace: "nowrap",
              background: theme.bg.prominent,
              border: `${theme.borderWidth.thin} solid ${theme.border.primary}`,
              borderRadius: theme.radius.pill,
              boxShadow: theme.shadow.sm,
              opacity: hoveredTab === t.id ? 1 : 0,
              transform: hoveredTab === t.id ? "translateX(0)" : "translateX(-4px)",
              transition: `opacity ${theme.anim.hover} ease-out, transform ${theme.anim.hover} ease-out`,
              pointerEvents: "none",
            }}
          >
            {t.label}
          </div>
        ))}
      </div>

      {/* Content column */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
      {tab === "media" ? (
        <>
          {/* actionsRow (MediaTab.swift actionsRow, 28px): Import, the overflow "⋯" menu
              (New Folder / New Matte…), trailing search-index status. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: theme.spacing.xs,
              height: theme.size.panelHeader,
              boxSizing: "border-box",
              padding: `0 ${theme.spacing.sm}`,
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
            <Button testid="media-import" onClick={handleImportClick}>
              <span style={{ display: "flex", alignItems: "center", gap: theme.spacing.xs }}>
                <Icon name="plus" size={HEADER_ICON_SIZE} />
                Import
              </span>
            </Button>

            {/* Generate lives in the agent side of this port — Swift's toolbarButton("Generate", ...)
                has no equivalent here; deliberately not ported (recorded deviation). */}

            <div style={{ position: "relative" }} ref={overflowMenuRef}>
              <IconButton
                frame={OVERFLOW_ICON_FRAME}
                testid="media-overflow-toggle"
                title="More"
                onClick={() => setOverflowOpen((v) => !v)}
              >
                <Icon name="ellipsis" size={HEADER_ICON_SIZE} />
              </IconButton>
              <div
                style={{
                  position: "absolute",
                  top: `calc(100% + ${theme.spacing.xxs})`,
                  left: 0,
                  zIndex: theme.z.menu,
                  display: overflowOpen ? "block" : "none",
                }}
              >
                <MenuList items={overflowItems} onSelect={handleOverflowSelect} />
              </div>
            </div>

            <div style={{ flex: 1 }} />

            {indexLabel != null && (
              <div
                data-testid="media-index-status"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: theme.spacing.xs,
                  fontSize: theme.fontSize.xs,
                  color: theme.text.tertiary,
                  minWidth: 0,
                }}
              >
                <span style={{ whiteSpace: "nowrap" }}>{indexLabel}</span>
                {downloadableMissing.length > 0 && (
                  <Button
                    testid="media-index-download-model"
                    size="small"
                    onClick={handleDownloadModels}
                    disabled={downloadingModel != null}
                  >
                    {downloadingModel != null ? `Downloading ${MODEL_LABEL[downloadingModel]}…` : "Download model"}
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* searchControlsRow (MediaTab.swift searchControlsRow, 28px). No grid/list display-mode
              controls exist in this port yet (Swift's view/sort/filter menus aren't ported) —
              nothing to convert there, recorded deviation. */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: theme.spacing.xs,
              height: theme.size.panelHeader,
              boxSizing: "border-box",
              padding: `0 ${theme.spacing.sm}`,
              flexShrink: 0,
            }}
          >
            <SearchField
              testid="media-search"
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search"
              disabled
              style={{ flex: 1, minWidth: 0 }}
            />
          </div>

          {folderError != null && (
            <div
              data-testid="media-folder-error"
              style={{
                fontSize: theme.fontSize.xs,
                color: theme.status.error,
                background: theme.bg.surface,
                border: `${theme.borderWidth.hairline} solid ${theme.status.error}`,
                borderRadius: theme.radius.xs,
                padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
                margin: `0 ${theme.spacing.sm}`,
              }}
            >
              {folderError}
            </div>
          )}

          <MediaBreadcrumbs
            folders={folders}
            currentFolderId={currentFolderId}
            onNavigate={navigateTo}
            onDropOn={handleDropOnFolder}
            dragOverFolderId={dragOverFolderId}
            itemCount={childFolders.length + visibleEntries.length}
          />

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
            {childFolders.map((folder) => (
              <FolderTile
                key={folder.id}
                folder={folder}
                childCount={childCount(folder.id)}
                isSelected={selectedFolderId === folder.id}
                isRenaming={renamingFolderId === folder.id}
                onSelect={() => setSelectedFolderId(folder.id)}
                onOpen={() => navigateTo(folder.id)}
                onRenameStart={() => setRenamingFolderId(folder.id)}
                onRenameCommit={(name) => {
                  library.renameFolder(folder.id, name);
                  setRenamingFolderId(undefined);
                }}
                onRenameCancel={() => setRenamingFolderId(undefined)}
                onDelete={() => handleDeleteFolder(folder)}
                onDropPayload={(payload) => handleDropOnFolder(folder.id, payload)}
                dragOverActive={dragOverFolderId === folder.id}
              />
            ))}
            {visibleEntries.map((entry) => (
              <MediaItem
                key={entry.id}
                entry={entry}
                thumbnail={library.thumbnail(entry.id)}
                onPointerDown={onItemPointerDown}
              />
            ))}
          </div>
        </>
      ) : store && executor && transcription ? (
        <CaptionsTab store={store} executor={executor} transcription={transcription} library={library} />
      ) : (
        <div data-testid="captions-tab-unavailable" style={{ padding: theme.spacing.sm, fontSize: theme.fontSize.xs, color: theme.text.muted }}>
          Captions needs the AI facade — not wired for this host.
        </div>
      )}
      </div>

      {showMatteSheet && library.importBytes && (
        <MatteSheet
          library={{ importBytes: library.importBytes }}
          timelineWidth={timelineWidth}
          timelineHeight={timelineHeight}
          folderId={currentFolderId}
          onClose={() => setShowMatteSheet(false)}
        />
      )}
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
  const status = parseGenerationStatus(entry.generationStatus);
  const isGenerating = status.kind !== "none" && status.kind !== "failed";
  const isFailed = status.kind === "failed";

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
      {/* Thumbnail, generating overlay, failed state, or color tile */}
      <div
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "16/9",
          background: thumbnail && !isGenerating && !isFailed ? "transparent" : trackColor,
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {isGenerating ? (
          <GeneratingOverlay label={generatingLabel(status)} />
        ) : isFailed ? (
          <FailedTile message={status.message} />
        ) : thumbnail ? (
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

function FailedTile({ message }: { message: string }) {
  return (
    <div
      data-testid="media-item-failed"
      title={message}
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: theme.spacing.xxs,
        padding: theme.spacing.xs,
        textAlign: "center",
      }}
    >
      <span style={{ fontSize: theme.fontSize.mdLg, color: theme.status.error }}>{"⚠"}</span>
      <span style={{ fontSize: theme.fontSize.xs, fontWeight: theme.fontWeight.semibold, color: theme.text.secondary }}>
        Failed
      </span>
      <span
        style={{
          fontSize: theme.fontSize.xxs,
          color: theme.text.tertiary,
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {message}
      </span>
    </div>
  );
}
