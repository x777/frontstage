import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { EditorStore, MediaManifestEntry } from "@palmier/core";
import type { ProjectSession } from "@palmier/core";
import {
  addClipCommand,
  dropTargetAt,
  makeGeometry,
  frameAtX,
  DEFAULT_TRACK_HEIGHT,
  TIMELINE_HEADER_WIDTH,
} from "@palmier/core";
import type { MediaByteSource } from "@palmier/engine";
import { theme } from "../theme/theme.js";
import { Layout, persistLayout } from "../layout/Layout.js";
import { PreviewPanel } from "../preview/PreviewPanel.js";
import { TimelinePanel } from "../timeline/TimelinePanel.js";
import { MediaPanel } from "../media/MediaPanel.js";
import { MediaDragController } from "../media/media-drag.js";
import { InspectorPanel } from "../inspector/InspectorPanel.js";
import { FileMenu } from "./FileMenu.js";
import { useStore } from "../store/use-store.js";

// Duck-typed library interface covering what MediaPanel, InspectorPanel, and drag-drop each need.
export interface EditorLibrary {
  getSnapshot(): { entries: MediaManifestEntry[] };
  subscribe(cb: () => void): () => void;
  thumbnail(id: string): string | undefined;
  importFiles(files: File[] | FileList): Promise<MediaManifestEntry[]>;
  entry(id: string): MediaManifestEntry | undefined;
}

export interface EditorProps {
  store: EditorStore;
  media: MediaByteSource;
  library: EditorLibrary;
  session?: ProjectSession;
}

interface DiscardDialogState {
  resolve: (v: boolean) => void;
}

export function Editor({ store, media, library, session }: EditorProps) {
  const dragController = useMemo(() => new MediaDragController(), []);

  const dragSnap = useSyncExternalStore(
    dragController.subscribe.bind(dragController),
    dragController.getSnapshot.bind(dragController),
  );

  // Subscribe to store for dirty tracking
  useStore(store, (s) => s.timeline);

  // Subscribe to library for dirty tracking
  const [, setLibraryTick] = useState(0);
  useEffect(() => {
    if (!session) return;
    return library.subscribe(() => setLibraryTick((n) => n + 1));
  }, [session, library]);

  // Subscribe to session lifecycle changes (new/open/save/saveAs)
  const [sessionState, setSessionState] = useState(() => session?.getState());
  useEffect(() => {
    if (!session) return;
    setSessionState(session.getState());
    return session.subscribe(() => setSessionState(session.getState()));
  }, [session]);

  // Discard-guard dialog shared by both keyboard shortcuts and FileMenu
  const [dialog, setDialog] = useState<DiscardDialogState | null>(null);

  const isDirty = session?.isDirty() ?? false;

  const confirmDiscard = useCallback((): Promise<boolean> => {
    if (!isDirty) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      setDialog({ resolve });
    });
  }, [isDirty]);

  function closeDialog(result: boolean) {
    dialog?.resolve(result);
    setDialog(null);
  }

  async function handleDiscardSave() {
    await session?.save();
    closeDialog(true);
  }

  // Compute dirty title
  const projectName = sessionState?.name ?? "Palmier Pro";
  const title = session ? `${projectName}${isDirty ? " •" : ""}` : "Palmier Pro";

  useEffect(() => {
    document.title = title;
  }, [title]);

  // Keyboard shortcuts — use shared confirmDiscard so Ctrl+N / Ctrl+O honor the discard guard
  useEffect(() => {
    if (!session) return;
    function onKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        if (e.shiftKey) {
          session!.saveAs();
        } else {
          session!.save();
        }
      } else if (e.key === "o" || e.key === "O") {
        e.preventDefault();
        session!.open(confirmDiscard);
      } else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        session!.newProject(confirmDiscard);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [session, confirmDiscard]);

  useEffect(() => {
    return store.subscribe(() => persistLayout(store));
  }, [store]);

  useEffect(() => {
    let listenersAttached = false;

    const onPointerMove = (e: PointerEvent) => {
      dragController.update(e.clientX, e.clientY);
    };

    const onPointerUp = (e: PointerEvent) => {
      const result = dragController.end();
      if (result) {
        const canvas = document.querySelector('[data-testid="timeline-canvas"]') as HTMLCanvasElement | null;
        if (canvas) {
          const rect = canvas.getBoundingClientRect();
          const lx = result.clientX - rect.left;
          const ly = result.clientY - rect.top;
          if (lx >= 0 && lx <= rect.width && ly >= 0 && ly <= rect.height) {
            const storeSnap = store.getSnapshot();
            const geom = makeGeometry({
              pixelsPerFrame: storeSnap.view.zoom,
              scrollX: storeSnap.view.scrollX,
              headerWidth: TIMELINE_HEADER_WIDTH,
              trackHeights: storeSnap.timeline.tracks.map(() => DEFAULT_TRACK_HEIGHT),
            });
            const target = dropTargetAt(geom, ly);
            const dropFrame = frameAtX(geom, lx);
            store.dispatch(addClipCommand(result.entry, target, dropFrame, storeSnap.timeline.fps));
          }
        }
      }
      removeListeners();
    };

    const onPointerCancel = () => {
      dragController.cancel();
      removeListeners();
    };

    function removeListeners() {
      if (listenersAttached) {
        document.removeEventListener("pointermove", onPointerMove);
        document.removeEventListener("pointerup", onPointerUp);
        document.removeEventListener("pointercancel", onPointerCancel);
        listenersAttached = false;
      }
    }

    const unsubDrag = dragController.subscribe(() => {
      const snap = dragController.getSnapshot();
      if (snap && !listenersAttached) {
        document.addEventListener("pointermove", onPointerMove);
        document.addEventListener("pointerup", onPointerUp);
        document.addEventListener("pointercancel", onPointerCancel);
        listenersAttached = true;
      } else if (!snap && listenersAttached) {
        removeListeners();
      }
    });

    return () => {
      unsubDrag();
      removeListeners();
    };
  }, [dragController, store]);

  const overlayStyle: React.CSSProperties = {
    position: "fixed",
    inset: 0,
    background: theme.bg.scrim,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: theme.z.dialog,
  };

  const dialogStyle: React.CSSProperties = {
    background: theme.bg.raised,
    border: `${theme.borderWidth.thin} solid ${theme.border.primary}`,
    borderRadius: theme.radius.md,
    padding: theme.spacing.lg,
    minWidth: theme.size.dialogMin,
    boxShadow: theme.shadow.lg,
    display: "flex",
    flexDirection: "column",
    gap: theme.spacing.md,
  };

  const btnRowStyle: React.CSSProperties = {
    display: "flex",
    gap: theme.spacing.xs,
    justifyContent: "flex-end",
  };

  const dialogBtnStyle: React.CSSProperties = {
    background: "none",
    border: `${theme.borderWidth.thin} solid ${theme.border.subtle}`,
    borderRadius: theme.radius.xs,
    color: theme.text.primary,
    cursor: "pointer",
    fontSize: theme.fontSize.sm,
    padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
  };

  return (
    <>
      <Layout
        store={store}
        topBarSlot={
          session ? (
            <FileMenu
              session={session}
              isDirty={isDirty}
              confirmDiscard={confirmDiscard}
            />
          ) : undefined
        }
        title={title}
        media={
          <MediaPanel
            library={library}
            onItemPointerDown={(entry, e) => {
              e.preventDefault();
              dragController.start(entry, e.clientX, e.clientY);
            }}
          />
        }
        preview={<PreviewPanel store={store} media={media} />}
        timeline={<TimelinePanel store={store} dragController={dragController} />}
        inspector={<InspectorPanel store={store} library={library} />}
      />

      {dragSnap && (
        <div
          style={{
            position: "fixed",
            left: dragSnap.x + 12,
            top: dragSnap.y + 12,
            pointerEvents: "none",
            zIndex: 9999,
            background: theme.bg.raised,
            border: `1px solid ${theme.border.primary}`,
            borderRadius: theme.radius.xs,
            padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
            fontSize: theme.fontSize.xs,
            color: theme.text.primary,
            maxWidth: 160,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            boxShadow: theme.shadow.lg,
            opacity: theme.opacity.high,
          }}
        >
          {dragSnap.entry.name}
        </div>
      )}

      {dialog && (
        <div data-testid="discard-dialog" style={overlayStyle}>
          <div style={dialogStyle}>
            <span style={{ fontSize: theme.fontSize.sm, color: theme.text.primary }}>
              You have unsaved changes. Discard them?
            </span>
            <div style={btnRowStyle}>
              <button
                data-testid="discard-cancel"
                style={dialogBtnStyle}
                onClick={() => closeDialog(false)}
              >
                Cancel
              </button>
              <button
                data-testid="discard-dont-save"
                style={dialogBtnStyle}
                onClick={() => closeDialog(true)}
              >
                Don&apos;t Save
              </button>
              <button
                data-testid="discard-save"
                style={{ ...dialogBtnStyle, background: theme.accent.primary, border: "none", color: theme.text.onAccent }}
                onClick={handleDiscardSave}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
