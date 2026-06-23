import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
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

  // Compute dirty title
  const isDirty = session?.isDirty() ?? false;
  const projectName = sessionState?.name ?? "Palmier Pro";
  const title = session ? `${projectName}${isDirty ? " •" : ""}` : "Palmier Pro";

  useEffect(() => {
    document.title = title;
  }, [title]);

  // Keyboard shortcuts
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
        session!.open(() => Promise.resolve(true));
      } else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        session!.newProject(() => Promise.resolve(true));
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [session]);

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

  return (
    <>
      <Layout
        store={store}
        topBarSlot={session ? <FileMenu session={session} isDirty={isDirty} /> : undefined}
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
    </>
  );
}
