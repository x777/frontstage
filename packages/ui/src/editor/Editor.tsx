import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CubeLUT, EditorStore, GenerationLogEntry, MediaFolder, MediaManifestEntry, ProjectRef } from "@palmier/core";
import type { ProjectSession } from "@palmier/core";
import type { AgentSession, ChatSessionStore, ModelEntry, ToolContext } from "@palmier/ai";
import type { MentionItem } from "../agent/MentionInput.js";
import { SettingsPanel } from "../agent/SettingsPanel.js";
import type { KeyConfig, FalKeyConfig, McpSettings } from "../agent/SettingsPanel.js";
import type { SkillsPaneProps } from "../skills/SkillsPane.js";
import { ProjectActivityButton } from "./ProjectActivityView.js";
import {
  addClipCommand,
  dropTargetAt,
  makeGeometry,
  frameAtX,
  DEFAULT_TRACK_HEIGHT,
  resolveDropPlan,
  rippleInsertClipsSpecs,
} from "@palmier/core";
import { TRACK_HEADER_WIDTH } from "../timeline/TrackHeaders.js";
import type { RippleInsertSpec } from "@palmier/core";
import type { MediaByteSource, PlaybackEngine } from "@palmier/engine";
import { theme } from "../theme/theme.js";
import { Button, Dialog, IconButton } from "../primitives/index.js";
import { Layout, persistLayout } from "../layout/Layout.js";
import { PreviewPanel } from "../preview/PreviewPanel.js";
import { TimelinePanel } from "../timeline/TimelinePanel.js";
import { MediaPanel } from "../media/MediaPanel.js";
import type { CaptionsExecutor, CaptionsTranscriptionFacade } from "../media/CaptionsTab.js";
import type { MediaIndexingFacade } from "../media/MediaPanel.js";
import { MediaDragController } from "../media/media-drag.js";
import { FOLDER_DROP_ROOT } from "../media/FolderTile.js";
import { InspectorPanel } from "../inspector/InspectorPanel.js";
import { LutReconciler } from "../inspector/adjust/lut-reconciler.js";
import { FileMenu } from "./FileMenu.js";
import { AgentPanel } from "../agent/AgentPanel.js";
import { GenerationPanel } from "../agent/GenerationPanel.js";
import type { GenerationFacade } from "../agent/GenerationPanel.js";
import { useStore } from "../store/use-store.js";
import { useExportCommand } from "./use-export-command.js";
import type { ExportKind } from "./use-export-command.js";
import { ExportProgress } from "./ExportProgress.js";
import type { ExportGateway } from "./export-gateway.js";

// Duck-typed library interface covering what MediaPanel, InspectorPanel, and drag-drop each need.
export interface EditorLibrary {
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
  // .cube project persistence (M14C T2) — both optional so hosts/tests that predate this still
  // typecheck unmodified; the real MediaLibrary implements both.
  storeLut?(filename: string, bytes: Uint8Array): Promise<string>;
  readDerived?(relativePath: string): Promise<Uint8Array | null>;
}

export interface EditorProps {
  store: EditorStore;
  media: MediaByteSource;
  library: EditorLibrary;
  session?: ProjectSession;
  nativeFileMenu?: boolean;
  exportGateway?: ExportGateway;
  interopExport?: ToolContext["interopExport"];
  engineRef?: { current: PlaybackEngine | null };
  getGenerationLog?: () => GenerationLogEntry[];
  indexing?: MediaIndexingFacade;
  onReady?: (commands: { newProject: () => void; open: () => void; save: () => void; saveAs: () => void; export: (kind?: ExportKind) => void; openRecent: (ref: ProjectRef) => void }) => void;
  agent?: {
    session: AgentSession;
    model?: string;
    sessionStore?: ChatSessionStore;
    mentionItems?: MentionItem[];
    generation?: GenerationFacade;
    executor?: CaptionsExecutor;
    transcription?: CaptionsTranscriptionFacade;
    newId?: () => string;
    settings?: {
      keyConfig: KeyConfig;
      falKeyConfig?: FalKeyConfig;
      llmModels: ModelEntry[];
      imageModels: ModelEntry[];
      agentModel: string;
      imageModel: string;
      onAgentModelChange: (id: string) => void;
      onImageModelChange: (id: string) => void;
      confirmThreshold: number;
      onConfirmThresholdChange: (value: number) => void;
      mcp?: McpSettings;
      skills?: SkillsPaneProps;
    };
  };
}

interface DiscardDialogState {
  resolve: (v: boolean) => void;
}

export type RunProjectCommand = (fn: () => Promise<unknown>) => void;

export function Editor({ store, media, library, session, nativeFileMenu, exportGateway, interopExport, engineRef, onReady, agent, getGenerationLog, indexing }: EditorProps) {
  const dragController = useMemo(() => new MediaDragController(), []);

  const [agentVisible, setAgentVisible] = useState(() => {
    try { return localStorage.getItem("palmier.agent.visible") === "1"; } catch { return false; }
  });

  function toggleAgent() {
    setAgentVisible((prev) => {
      const next = !prev;
      try { localStorage.setItem("palmier.agent.visible", next ? "1" : "0"); } catch { /* storage unavailable */ }
      return next;
    });
  }

  const [generateVisible, setGenerateVisible] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);

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

  // Error notice for failed project commands
  const [error, setError] = useState<string | null>(null);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showError(msg: string) {
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    setError(msg);
    errorTimerRef.current = setTimeout(() => setError(null), 5000);
  }

  function dismissError() {
    if (errorTimerRef.current) clearTimeout(errorTimerRef.current);
    setError(null);
  }

  // Central runner: swallows throws and surfaces them as a non-fatal notice.
  const runProjectCommand: RunProjectCommand = useCallback((fn) => {
    fn().catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : String(e);
      showError(msg);
    });
  }, []);

  const { exportProject, exportState, canExport, canExportXml, canExportCaptions } = useExportCommand({
    exportGateway,
    interopExport,
    getTimeline: () => store.getSnapshot().timeline,
    getMediaEntries: () => library.getSnapshot().entries,
    media,
    suggestedName: () => session?.getState().name ?? "Untitled",
    runProjectCommand,
  });

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

  // Expose guarded commands to the native menu layer (desktop only)
  const onReadyRef = useRef(onReady);
  useEffect(() => { onReadyRef.current = onReady; }, [onReady]);
  const confirmDiscardRef = useRef(confirmDiscard);
  useEffect(() => { confirmDiscardRef.current = confirmDiscard; }, [confirmDiscard]);
  const exportProjectRef = useRef(exportProject);
  useEffect(() => { exportProjectRef.current = exportProject; }, [exportProject]);
  useEffect(() => {
    if (!session || !onReadyRef.current) return;
    onReadyRef.current({
      newProject: () => runProjectCommand(() => session.newProject(() => confirmDiscardRef.current())),
      open: () => runProjectCommand(() => session.open(() => confirmDiscardRef.current())),
      save: () => runProjectCommand(() => session.save()),
      saveAs: () => runProjectCommand(() => session.saveAs()),
      export: (kind?: ExportKind) => exportProjectRef.current(kind),
      openRecent: (ref: ProjectRef) => runProjectCommand(() => session.open(() => confirmDiscardRef.current(), ref)),
    });
  // Run once when session + handlers are stable
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Keyboard shortcuts — use shared confirmDiscard so Ctrl+N / Ctrl+O honor the discard guard
  useEffect(() => {
    if (!session) return;
    function onKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        if (e.shiftKey) {
          runProjectCommand(() => session!.saveAs());
        } else {
          runProjectCommand(() => session!.save());
        }
      } else if (e.key === "o" || e.key === "O") {
        e.preventDefault();
        runProjectCommand(() => session!.open(confirmDiscard));
      } else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        runProjectCommand(() => session!.newProject(confirmDiscard));
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [session, confirmDiscard, runProjectCommand]);

  useEffect(() => {
    return store.subscribe(() => persistLayout(store));
  }, [store]);

  // LUT auto re-register (M14C T2): after a project load (or an agent apply_color pick), the
  // engine's per-path texture cache is empty until the bytes are re-read/re-parsed — no re-pick
  // needed. engineRef.current may not be ready yet on the first store notification; reconcile()
  // no-ops until it is, and the very frequent playhead-change notifications during playback (or
  // any other edit) give it plenty of chances to catch up once the engine finishes initializing.
  const lutReconciler = useMemo(() => new LutReconciler(), [store]);
  useEffect(() => {
    if (!library.readDerived) return;
    const readDerived = library.readDerived.bind(library);
    const run = () => {
      const registerLUT = engineRef?.current
        ? (path: string, cube: CubeLUT) => engineRef.current!.registerLUT(path, cube)
        : undefined;
      lutReconciler.reconcile(store.getSnapshot().timeline, readDerived, registerLUT);
    };
    run();
    return store.subscribe(run);
  }, [store, library, engineRef, lutReconciler]);

  useEffect(() => {
    let listenersAttached = false;

    // Hit-test the custom drag against folder drop targets (FolderTile/MediaBreadcrumbs
    // both carry `data-folder-drop`) — real Chromium suppresses native HTML5 dragstart once
    // pointerdown.preventDefault() has fired, so asset->folder drops route through this
    // pointer-based gesture instead of the native DnD path used by folder tiles.
    const folderDropTargetAt = (clientX: number, clientY: number): string | null => {
      const el = document.elementFromPoint(clientX, clientY)?.closest("[data-folder-drop]");
      return el?.getAttribute("data-folder-drop") ?? null;
    };

    const onPointerMove = (e: PointerEvent) => {
      dragController.update(e.clientX, e.clientY, e.metaKey || e.ctrlKey, folderDropTargetAt(e.clientX, e.clientY));
    };

    const onPointerUp = (e: PointerEvent) => {
      const result = dragController.end();
      if (result) {
        const folderId = folderDropTargetAt(result.clientX, result.clientY);
        if (folderId !== null) {
          library.moveEntriesToFolder([result.entry.id], folderId === FOLDER_DROP_ROOT ? undefined : folderId);
          removeListeners();
          return;
        }
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
              headerWidth: TRACK_HEADER_WIDTH,
              trackHeights: storeSnap.timeline.tracks.map(() => DEFAULT_TRACK_HEIGHT),
            });
            const target = dropTargetAt(geom, ly);
            const dropFrame = frameAtX(geom, lx);
            const isRipple = result.ripple || e.metaKey || e.ctrlKey;
            if (isRipple) {
              const { entry } = result;
              const fps = storeSnap.timeline.fps;
              const plan = resolveDropPlan(
                storeSnap.timeline,
                target,
                entry.type,
                entry.hasAudio === true,
                Math.max(1, Math.round((entry.duration ?? 0) * fps)),
              );
              const visualTrackIndex = plan.visualTarget?.kind === "existing" ? plan.visualTarget.index : null;
              if (visualTrackIndex !== null) {
                const durationFrames = Math.max(1, Math.round((entry.duration ?? 0) * fps));
                const specs: RippleInsertSpec[] = [{ entry, durationFrames }];
                const base = crypto.randomUUID();
                let n = 0;
                const detId = () => `${base}-${n++}`;
                store.dispatch({
                  label: "Ripple Insert",
                  apply: (t) => {
                    n = 0;
                    return rippleInsertClipsSpecs(t, specs, visualTrackIndex, dropFrame, fps, detId).timeline;
                  },
                });
              } else {
                // Audio-only or new-track ripple: fall back to overwrite insert
                store.dispatch(addClipCommand(result.entry, target, dropFrame, storeSnap.timeline.fps));
              }
            } else {
              store.dispatch(addClipCommand(result.entry, target, dropFrame, storeSnap.timeline.fps));
            }
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
  }, [dragController, store, library]);

  return (
    <>
      <Layout
        store={store}
        topBarSlot={
          (session || agent) ? (
            <>
              {session && !nativeFileMenu && (
                <FileMenu
                  session={session}
                  confirmDiscard={confirmDiscard}
                  runProjectCommand={runProjectCommand}
                  onExport={(canExport || canExportXml || canExportCaptions) ? exportProject : undefined}
                  canExportXml={canExportXml}
                  canExportCaptions={canExportCaptions}
                />
              )}
              {agent && (
                <Button
                  testid="agent-toggle"
                  onClick={toggleAgent}
                  variant={agentVisible ? "accent" : "default"}
                >
                  Agent
                </Button>
              )}
              {agent?.generation && (
                <Button
                  testid="generate-toggle"
                  onClick={() => setGenerateVisible((v) => !v)}
                  variant={generateVisible ? "accent" : "default"}
                >
                  Generate
                </Button>
              )}
              {agent?.settings && (
                <IconButton
                  testid="settings-toggle"
                  onClick={() => setSettingsVisible((v) => !v)}
                  active={settingsVisible}
                >
                  ⚙
                </IconButton>
              )}
              {getGenerationLog && <ProjectActivityButton getGenerationLog={getGenerationLog} />}
            </>
          ) : undefined
        }
        title={title}
        agent={agent ? (
          <AgentPanel
            session={agent.session}
            model={agent.model}
            sessionStore={agent.sessionStore}
            mentionItems={agent.mentionItems}
            llmModels={agent.settings?.llmModels}
            onModelChange={agent.settings?.onAgentModelChange}
            onOpenSkills={agent.settings?.skills ? () => setSettingsVisible(true) : undefined}
          />
        ) : undefined}
        agentVisible={agentVisible}
        media={
          <MediaPanel
            library={library}
            store={store}
            executor={agent?.executor}
            transcription={agent?.transcription}
            indexing={indexing}
            dragOverFolderId={dragSnap?.hoverFolderId}
            onItemPointerDown={(entry, e) => {
              e.preventDefault();
              dragController.start(entry, e.clientX, e.clientY, e.metaKey || e.ctrlKey);
            }}
          />
        }
        preview={<PreviewPanel store={store} media={media} engineRef={engineRef} />}
        timeline={<TimelinePanel store={store} dragController={dragController} library={library} />}
        inspector={<InspectorPanel store={store} library={library} engineRef={engineRef} lutReconciler={lutReconciler} />}
      />

      <ExportProgress state={exportState} />

      {generateVisible && agent?.generation && (
        <GenerationPanel
          generation={agent.generation}
          newId={agent.newId ?? (() => crypto.randomUUID())}
          entries={() => library.getSnapshot().entries}
          onClose={() => setGenerateVisible(false)}
        />
      )}

      {settingsVisible && agent?.settings && (
        <SettingsPanel
          keyConfig={agent.settings.keyConfig}
          falKeyConfig={agent.settings.falKeyConfig}
          llmModels={agent.settings.llmModels}
          imageModels={agent.settings.imageModels}
          agentModel={agent.settings.agentModel}
          imageModel={agent.settings.imageModel}
          onAgentModelChange={agent.settings.onAgentModelChange}
          onImageModelChange={agent.settings.onImageModelChange}
          confirmThreshold={agent.settings.confirmThreshold}
          onConfirmThresholdChange={agent.settings.onConfirmThresholdChange}
          onClose={() => setSettingsVisible(false)}
          mcp={agent.settings.mcp}
          skills={agent.settings.skills}
        />
      )}

      {dragSnap && (
        <div
          style={{
            position: "fixed",
            left: `calc(${dragSnap.x}px + ${theme.spacing.mdLg})`,
            top: `calc(${dragSnap.y}px + ${theme.spacing.mdLg})`,
            pointerEvents: "none",
            zIndex: theme.z.dragGhost,
            background: theme.bg.raised,
            border: `${theme.borderWidth.thin} solid ${theme.border.primary}`,
            borderRadius: theme.radius.xs,
            padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
            fontSize: theme.fontSize.xs,
            color: theme.text.primary,
            maxWidth: theme.size.menuMin,
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
        // Wrapper keeps the stable "discard-dialog" testid — Dialog's own scrim/panel are suffixed.
        <div data-testid="discard-dialog" style={{ position: "fixed", inset: 0, zIndex: theme.z.dialog }}>
          <Dialog
            testid="discard"
            footer={
              <>
                <Button testid="discard-cancel" onClick={() => closeDialog(false)}>Cancel</Button>
                <Button testid="discard-dont-save" variant="destructive" onClick={() => closeDialog(true)}>Don&apos;t Save</Button>
                <Button testid="discard-save" variant="accent" onClick={handleDiscardSave}>Save</Button>
              </>
            }
          >
            <span style={{ fontSize: theme.fontSize.sm, color: theme.text.primary }}>
              You have unsaved changes. Discard them?
            </span>
          </Dialog>
        </div>
      )}

      {error && (
        <div
          data-testid="project-error"
          style={{
            position: "fixed",
            bottom: theme.spacing.xl,
            left: "50%",
            transform: "translateX(-50%)",
            background: theme.bg.raised,
            border: `${theme.borderWidth.thin} solid ${theme.status.error}`,
            borderRadius: theme.radius.sm,
            padding: `${theme.spacing.xs} ${theme.spacing.md}`,
            color: theme.status.error,
            fontSize: theme.fontSize.sm,
            zIndex: theme.z.toast,
            display: "flex",
            alignItems: "center",
            gap: theme.spacing.sm,
            boxShadow: theme.shadow.lg,
            maxWidth: theme.size.toastMax,
          }}
        >
          <span style={{ flex: 1 }}>{error}</span>
          <button
            onClick={dismissError}
            style={{
              background: "none",
              border: "none",
              color: theme.status.error,
              cursor: "pointer",
              fontSize: theme.fontSize.md,
              padding: 0,
              lineHeight: 1,
            }}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}
