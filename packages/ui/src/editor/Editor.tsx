import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { EditorStore, MediaManifestEntry, ProjectRef } from "@palmier/core";
import type { ProjectSession } from "@palmier/core";
import type { AgentSession, ChatSessionStore, ImageGenerator, ModelEntry } from "@palmier/ai";
import type { MentionItem } from "../agent/MentionInput.js";
import { SettingsPanel } from "../agent/SettingsPanel.js";
import type { KeyConfig } from "../agent/SettingsPanel.js";
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
import { AgentPanel } from "../agent/AgentPanel.js";
import { GenerationPanel } from "../agent/GenerationPanel.js";
import { useStore } from "../store/use-store.js";
import { useExportCommand } from "./use-export-command.js";
import { ExportProgress } from "./ExportProgress.js";
import type { ExportGateway } from "./export-gateway.js";

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
  exportGateway?: ExportGateway;
  onReady?: (commands: { newProject: () => void; open: () => void; save: () => void; saveAs: () => void; export: () => void; openRecent: (ref: ProjectRef) => void }) => void;
  agent?: {
    session: AgentSession;
    model?: string;
    sessionStore?: ChatSessionStore;
    mentionItems?: MentionItem[];
    imageGenerator?: ImageGenerator;
    settings?: {
      keyConfig: KeyConfig;
      llmModels: ModelEntry[];
      imageModels: ModelEntry[];
      agentModel: string;
      imageModel: string;
      onAgentModelChange: (id: string) => void;
      onImageModelChange: (id: string) => void;
    };
  };
}

interface DiscardDialogState {
  resolve: (v: boolean) => void;
}

export type RunProjectCommand = (fn: () => Promise<unknown>) => void;

export function Editor({ store, media, library, session, exportGateway, onReady, agent }: EditorProps) {
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

  const { exportProject, exportState, canExport } = useExportCommand({
    exportGateway,
    getTimeline: () => store.getSnapshot().timeline,
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
      export: () => exportProjectRef.current(),
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
          (session || agent) ? (
            <>
              {session && (
                <FileMenu
                  session={session}
                  confirmDiscard={confirmDiscard}
                  runProjectCommand={runProjectCommand}
                  onExport={canExport ? exportProject : undefined}
                />
              )}
              {agent && (
                <button
                  data-testid="agent-toggle"
                  onClick={toggleAgent}
                  style={{
                    background: agentVisible ? theme.accent.primary : "none",
                    border: `${theme.borderWidth.thin} solid ${agentVisible ? theme.accent.primary : theme.border.subtle}`,
                    borderRadius: theme.radius.xs,
                    color: agentVisible ? theme.text.onAccent : theme.text.secondary,
                    cursor: "pointer",
                    fontSize: theme.fontSize.xs,
                    padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
                    lineHeight: 1,
                  }}
                >
                  Agent
                </button>
              )}
              {agent?.imageGenerator && (
                <button
                  data-testid="generate-toggle"
                  onClick={() => setGenerateVisible((v) => !v)}
                  style={{
                    background: generateVisible ? theme.accent.primary : "none",
                    border: `${theme.borderWidth.thin} solid ${generateVisible ? theme.accent.primary : theme.border.subtle}`,
                    borderRadius: theme.radius.xs,
                    color: generateVisible ? theme.text.onAccent : theme.text.secondary,
                    cursor: "pointer",
                    fontSize: theme.fontSize.xs,
                    padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
                    lineHeight: 1,
                  }}
                >
                  Generate
                </button>
              )}
              {agent?.settings && (
                <button
                  data-testid="settings-toggle"
                  onClick={() => setSettingsVisible((v) => !v)}
                  style={{
                    background: settingsVisible ? theme.accent.primary : "none",
                    border: `${theme.borderWidth.thin} solid ${settingsVisible ? theme.accent.primary : theme.border.subtle}`,
                    borderRadius: theme.radius.xs,
                    color: settingsVisible ? theme.text.onAccent : theme.text.secondary,
                    cursor: "pointer",
                    fontSize: theme.fontSize.xs,
                    padding: `${theme.spacing.xxs} ${theme.spacing.xs}`,
                    lineHeight: 1,
                  }}
                >
                  ⚙
                </button>
              )}
            </>
          ) : undefined
        }
        title={title}
        agent={agent ? <AgentPanel session={agent.session} model={agent.model} sessionStore={agent.sessionStore} mentionItems={agent.mentionItems} llmModels={agent.settings?.llmModels} onModelChange={agent.settings?.onAgentModelChange} /> : undefined}
        agentVisible={agentVisible}
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

      <ExportProgress state={exportState} />

      {generateVisible && agent?.imageGenerator && (
        <GenerationPanel
          generate={(i) => agent.imageGenerator!.generate(i)}
          model={agent.settings?.imageModel ?? agent.model}
          imageModels={agent.settings?.imageModels}
          imageModel={agent.settings?.imageModel}
          onImageModelChange={agent.settings?.onImageModelChange}
          onClose={() => setGenerateVisible(false)}
        />
      )}

      {settingsVisible && agent?.settings && (
        <SettingsPanel
          keyConfig={agent.settings.keyConfig}
          llmModels={agent.settings.llmModels}
          imageModels={agent.settings.imageModels}
          agentModel={agent.settings.agentModel}
          imageModel={agent.settings.imageModel}
          onAgentModelChange={agent.settings.onAgentModelChange}
          onImageModelChange={agent.settings.onImageModelChange}
          onClose={() => setSettingsVisible(false)}
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
            maxWidth: "480px",
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
