import { StrictMode, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { EditorStore, ProjectSession, defaultTimeline, SAMPLER_VERSION } from "@palmier/core";
import type { MediaManifestEntry } from "@palmier/core";
import "@palmier/ui/theme/tokens.css";
import { Editor, MediaLibrary, createEditorHost, localProjectStore, measureCaptionWidthFrac, MediaIndexingService, IndexingStatusRelay, createDomFrameTap, createDomOpenMedia } from "@palmier/ui";
import type { KeyConfig, FalKeyConfig, MediaIndexingHost, MediaIndexingFacade } from "@palmier/ui";
import { AgentSession, ChatSessionStore, ToolExecutor, buildCatalog, toolsToMcp, ImageGenerator, GenerationService, listLLMModels, listImageModels, defaultLLMModel, defaultImageModel, MODEL_CATALOG, makeEntryUrl, TranscriptionService, EmbeddingService, createTransformersPipelines } from "@palmier/ai";
import type { GenerationHost, StartJobArgs, TranscriptionHost } from "@palmier/ai";

declare global {
  interface Window {
    desktopMcp?: {
      setEnabled(on: boolean): Promise<{ enabled: boolean }>;
      getStatus(): Promise<{ enabled: boolean; running: boolean; url: string; token: string }>;
      regenerateToken(): Promise<string>;
      onBridgeRequest(cb: (msg: { id: number; kind: string; payload?: unknown }) => void): void;
      bridgeRespond(id: number, payload: { result?: unknown; error?: string }): void;
    };
  }
}
import { DesktopGateway } from "./desktop-gateway.js";
import type { DesktopProjectRef } from "./desktop-gateway.js";
import { DesktopExportGateway } from "./desktop-export-gateway.js";
import { DesktopAiGateway } from "./desktop-ai-gateway.js";
import { DesktopGenGateway } from "./desktop-gen-gateway.js";
import { makeDesktopAudioExtractor } from "./desktop-audio-extract.js";
import { createDesktopMediaImport } from "./desktop-media-import.js";
import { createDesktopInteropExport } from "./desktop-interop-export.js";
import type { PlaybackEngine } from "@palmier/engine";

const engineRef: { current: PlaybackEngine | null } = { current: null };
const store = new EditorStore(defaultTimeline());
const library = new MediaLibrary();
const gateway = new DesktopGateway();
const { host, wrappedGateway, appendGenerationLog, getGenerationLog } = createEditorHost(store, library, gateway);
const session = new ProjectSession(host, wrappedGateway);
const exportGateway = new DesktopExportGateway();

// Build agent session — __aiGateway seam takes precedence (e2e injects a fake)
const _desktopAiGateway = new DesktopAiGateway();
const agentGateway = (window as unknown as Record<string, unknown>).__aiGateway ?? _desktopAiGateway;
const initialAgentModel = localStorage.getItem("palmier.agent.model") ?? defaultLLMModel();
const initialImageModel = localStorage.getItem("palmier.image.model") ?? defaultImageModel();
const imageGenerator = new ImageGenerator({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  gateway: agentGateway as any,
  host: { addMedia: (e, b) => library.addEntry(e, b), appendGenerationLog },
  model: initialImageModel,
});
(window as unknown as Record<string, unknown>).__imageGenerator = imageGenerator;

// Generation orchestrator (image/video jobs) — gateway is main-process-only (fal key never in renderer).
const genGateway = new DesktopGenGateway();
const generationHost: GenerationHost = {
  addPlaceholder: (entry) => library.addPlaceholder(entry),
  patchEntry: (id, patch) => library.patchEntry(id, patch),
  finalizeGenerated: (id, bytes, patch) => library.finalizeGenerated(id, bytes, patch),
  markGenerationFailed: (ids, message) => library.markGenerationFailed(ids, message),
  entries: () => library.getSnapshot().entries,
  appendGenerationLog,
  requestCheckpoint: () => { void session.save(); },
  notifyComplete: (assetName) => {
    if (!("Notification" in globalThis) || Notification.permission !== "granted") return;
    new Notification("Generation complete", { body: assetName });
  },
};
const generationServiceRef: { current: GenerationService } = {
  current: new GenerationService(genGateway, generationHost),
};
(window as unknown as Record<string, unknown>).__generationService = generationServiceRef;

// Visual-search embedding runtime (SigLIP2, M12C) — long-lived across project opens; the model
// weights are a one-time download, not per-project state. createTransformersPipelines' loader
// keeps the transformers.js import lazy (dynamic import()) until ensureReady() actually runs.
const embeddingService = new EmbeddingService(createTransformersPipelines());
(window as unknown as Record<string, unknown>).__embeddingService = embeddingService;

// Background visual indexing (M12C T3, the GenerationService pattern) — dispose+recreate per
// project open since its queue is tied to the open project's library entries.
const mediaIndexingHost: MediaIndexingHost = {
  entries: () => library.getSnapshot().entries,
  patchEntry: (id, patch) => library.patchEntry(id, patch),
  writeDerived: (relativePath, bytes) => library.writeDerived(relativePath, bytes),
  readDerived: (relativePath) => library.readDerived(relativePath),
};
function makeMediaIndexingService(): MediaIndexingService {
  return new MediaIndexingService({
    library: mediaIndexingHost,
    embedding: embeddingService,
    sampleFrames: createDomFrameTap(),
    samplerVersion: SAMPLER_VERSION,
    openMedia: createDomOpenMedia(library.byteSource),
  });
}
const mediaIndexingServiceRef: { current: MediaIndexingService } = { current: makeMediaIndexingService() };
const indexingStatusRelay = new IndexingStatusRelay(mediaIndexingServiceRef.current);
// Resweeps on every library mutation (new imports/generations finalizing) — registered once on
// the (stable, never-recreated) library; always dereferences the CURRENT service via the ref.
library.subscribe(() => mediaIndexingServiceRef.current.start());

// The panel's "Download model" action (M12C T4) — same embeddingService the search_media tool's
// confirm gate drives, so a click here and a confirm:true tool call share one single-flight download.
const indexingFacade: MediaIndexingFacade = {
  getStatus: () => indexingStatusRelay.getStatus(),
  subscribe: (cb) => indexingStatusRelay.subscribe(cb),
  ensureReady: (onProgress) => embeddingService.ensureReady(onProgress),
};
(window as unknown as Record<string, unknown>).__mediaIndexingService = mediaIndexingServiceRef;

// Every successful open resumes in-flight jobs from the loaded manifest;
// dispose+recreate first since there's no separate "close project" action.
session.onOpened = () => {
  generationServiceRef.current.dispose();
  generationServiceRef.current = new GenerationService(genGateway, generationHost);
  generationServiceRef.current.resumePending();

  mediaIndexingServiceRef.current.dispose();
  mediaIndexingServiceRef.current = makeMediaIndexingService();
  indexingStatusRelay.rewire(mediaIndexingServiceRef.current);
  mediaIndexingServiceRef.current.start();
};

// Resolves a library media ref to a fal-fetchable URL — cache-first (6-day TTL), else uploads.
const entryUrl = makeEntryUrl({
  entries: () => library.getSnapshot().entries,
  patchEntry: (id, patch) => library.patchEntry(id, patch),
  bytesFor: (entry) => library.bytesFor(entry),
  readMedia: (relativePath) => library.readMedia(relativePath),
  uploadFile: (bytes, contentType, fileName) => genGateway.uploadFile(bytes, contentType, fileName),
  now: () => Date.now(),
});

// Transcription orchestrator (fal-ai/wizper) — the M11B tools + M11D Captions tab consume this ref.
const transcriptionHost: TranscriptionHost = {
  entries: () => library.getSnapshot().entries,
  patchEntry: (id, patch) => library.patchEntry(id, patch),
  writeDerived: (relativePath, bytes) => library.writeDerived(relativePath, bytes),
  readDerived: (relativePath) => library.readDerived(relativePath),
};
// Shared by the audio extractor and the interop-export timecode facade below.
function resolveMediaPath(mediaRef: string): string | null {
  const entry = library.entry(mediaRef);
  if (!entry) return null;
  if (entry.source.kind === "external") return entry.source.absolutePath;
  const ref = session.getState().ref as DesktopProjectRef | null;
  return ref ? `${ref.path}/${entry.source.relativePath}` : null;
}

const audioExtractor = makeDesktopAudioExtractor({
  libraryBytes: (mediaRef) => {
    const entry = library.entry(mediaRef);
    return entry ? library.bytesFor(entry) ?? null : null;
  },
  resolvePath: resolveMediaPath,
});
const transcriptionServiceRef: { current: TranscriptionService } = {
  current: new TranscriptionService(genGateway, transcriptionHost, audioExtractor),
};
(window as unknown as Record<string, unknown>).__transcriptionService = transcriptionServiceRef;

// SAME object threaded into the ToolExecutor context and the manual GenerationPanel — one facade, two callers.
const generationFacade = {
  hasKey: () => genGateway.hasKey(),
  addPlaceholder: (entry: MediaManifestEntry) => library.addPlaceholder(entry),
  startJob: (args: StartJobArgs) => generationServiceRef.current.startJob(args),
  entryUrl,
  confirmThreshold: 50,
};

// Delegates through the ref (not a captured instance) so any future recreate is picked up.
const transcriptionFacade = {
  transcribe: (mediaRef: string, opts?: { language?: string }) => transcriptionServiceRef.current.transcribe(mediaRef, opts),
  cachedTranscript: (mediaRef: string) => transcriptionServiceRef.current.cachedTranscript(mediaRef),
  hasKey: () => transcriptionServiceRef.current.hasKey(),
  estimateCredits: (durationSeconds: number) => transcriptionServiceRef.current.estimateCredits(durationSeconds),
  // M11D: a real Canvas2D measure, at the timeline's own render width — upgrades add_captions' heuristic.
  measureText: (text: string, style: { fontName: string; fontSize: number }) =>
    measureCaptionWidthFrac(text, style, store.getSnapshot().timeline.width),
};

// SAME object threaded into the ToolExecutor context; T4 wires the real visual search scope + the
// model-download confirm gate on top of ready()/ensureReady(). cachedEmbeddings delegates through
// the indexing service ref so it always reads the current project's cache.
const embeddingFacade = {
  ready: () => embeddingService.state === "ready",
  ensureReady: (onProgress?: (p: { loaded: number; total: number }) => void) => embeddingService.ensureReady(onProgress),
  embedText: (q: string) => embeddingService.embedText(q),
  cachedEmbeddings: (mediaRef: string) => mediaIndexingServiceRef.current.cachedEmbeddings(mediaRef),
  modelInfo: embeddingService.info,
};

// SAME object threaded into the ToolExecutor context and (once T4 lands) the panel's drag/drop —
// mirrors the generation/transcription facade pattern above.
const libraryFacade = {
  listFolders: () => library.getManifest().folders,
  createFolder: (name: string, parentFolderId?: string) => library.createFolder(name, parentFolderId),
  renameFolder: (id: string, name: string) => library.renameFolder(id, name),
  renameEntry: (id: string, name: string) => library.renameEntry(id, name),
  moveEntriesToFolder: (assetIds: string[], folderId: string | undefined) => library.moveEntriesToFolder(assetIds, folderId),
  deleteFolders: (ids: string[]) => library.deleteFolders(ids),
  deleteEntries: (ids: string[]) => library.deleteEntries(ids),
};

const mediaImportFacade = createDesktopMediaImport({
  library,
  getProjectDir: () => (session.getState().ref as DesktopProjectRef | null)?.path,
});

// SAME object threaded into the ToolExecutor context and useExportCommand's XML/FCPXML path —
// mirrors the generation/transcription/library facade pattern above.
const interopExportFacade = createDesktopInteropExport({
  resolvePath: resolveMediaPath,
  getProjectDir: () => (session.getState().ref as DesktopProjectRef | null)?.path,
});

const executor = new ToolExecutor(buildCatalog(), {
  store,
  getManifest: () => library.getManifest(),
  newId: () => crypto.randomUUID(),
  generateImage: (input) => imageGenerator.generate(input),
  renderFrame: async (atFrame: number) => {
    const engine = engineRef.current;
    if (!engine) throw new Error("Engine not ready");
    await engine.seek(atFrame, "exact");
    const rgba = await engine.readRGBA();
    return { rgba, width: engine.width, height: engine.height };
  },
  generation: generationFacade,
  transcription: transcriptionFacade,
  embedding: embeddingFacade,
  library: libraryFacade,
  mediaImport: mediaImportFacade,
  interopExport: interopExportFacade,
  projectName: () => session.getState().name,
});
const agentSession = new AgentSession({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  gateway: agentGateway as any,
  executor,
  tools: buildCatalog(),
  model: initialAgentModel,
});

const sessionStore = new ChatSessionStore(localProjectStore("palmier.chats"));

// Build mention items from the library's media entries
const mentionItems = library.getManifest().entries.map((e) => ({
  id: e.id,
  label: e.name,
  kind: "media" as const,
  contextText: `@media ${e.name} (${e.type}, ${e.duration}s, id=${e.id})`,
}));

// Register MCP bridge handler (main↔renderer IPC)
window.desktopMcp?.onBridgeRequest(async ({ id, kind, payload }) => {
  try {
    let result: unknown;
    if (kind === "listTools") {
      result = toolsToMcp(executor.list());
    } else if (kind === "callTool") {
      const p = payload as { name: string; args: unknown };
      result = await executor.execute(p.name, p.args);
    } else if (kind === "listResources") {
      result = [
        { uri: "palmier://models", name: "Models", description: "Available AI models", mimeType: "application/json" },
        { uri: "palmier://timeline", name: "Timeline", description: "Current project timeline", mimeType: "application/json" },
      ];
    } else if (kind === "readResource") {
      const uri = (payload as { uri: string }).uri;
      let text: string;
      if (uri === "palmier://models") {
        text = JSON.stringify(MODEL_CATALOG);
      } else if (uri === "palmier://timeline") {
        const r = await executor.execute("get_timeline", {});
        const block = r.blocks.find((b) => b.kind === "text");
        text = block && block.kind === "text" ? block.text : "{}";
      } else {
        window.desktopMcp!.bridgeRespond(id, { error: "unknown resource: " + uri });
        return;
      }
      result = { contents: [{ uri, mimeType: "application/json", text }] };
    } else {
      window.desktopMcp!.bridgeRespond(id, { error: "unknown bridge kind: " + kind });
      return;
    }
    window.desktopMcp!.bridgeRespond(id, { result });
  } catch (e) {
    window.desktopMcp!.bridgeRespond(id, { error: String(e) });
  }
});

// Expose for E2E tests
(window as unknown as Record<string, unknown>).__palmierStore = store;
(window as unknown as Record<string, unknown>).__mediaLibrary = library;
(window as unknown as Record<string, unknown>).__projectSession = session;
(window as unknown as Record<string, unknown>).__desktopGateway = gateway;
(window as unknown as Record<string, unknown>).__agentSession = agentSession;

const isMac = window.desktopProject?.platform === "darwin";

function PalmierDesktopApp() {
  const [agentModelId, setAgentModelId] = useState(() => localStorage.getItem("palmier.agent.model") ?? defaultLLMModel());
  const [imageModelId, setImageModelId] = useState(() => localStorage.getItem("palmier.image.model") ?? defaultImageModel());
  const [hasKey, setHasKey] = useState(false);
  const [falHasKey, setFalHasKey] = useState(false);

  useEffect(() => {
    window.desktopAI?.hasKey().then(setHasKey).catch(() => {});
    window.desktopAI?.hasKey("fal").then(setFalHasKey).catch(() => {});
  }, []);

  function onAgentModelChange(id: string) {
    setAgentModelId(id);
    agentSession.setModel(id);
    localStorage.setItem("palmier.agent.model", id);
  }

  function onImageModelChange(id: string) {
    setImageModelId(id);
    imageGenerator.setModel(id);
    localStorage.setItem("palmier.image.model", id);
  }

  const keyConfig: KeyConfig = {
    kind: "keychain",
    hasKey,
    onSetKey: async (k) => {
      if (!window.desktopAI) return;
      await window.desktopAI.setKey(k);
      setHasKey(true);
    },
    onClearKey: async () => {
      if (!window.desktopAI) return;
      await window.desktopAI.clearKey();
      setHasKey(false);
    },
  };

  const falKeyConfig: FalKeyConfig = {
    kind: "keychain",
    hasKey: falHasKey,
    onSetKey: async (k) => {
      if (!window.desktopAI) return;
      await window.desktopAI.setKey(k, "fal");
      setFalHasKey(true);
    },
    onClearKey: async () => {
      if (!window.desktopAI) return;
      await window.desktopAI.clearKey("fal");
      setFalHasKey(false);
    },
  };

  return (
    <Editor
      store={store}
      media={library.byteSource}
      library={library}
      session={session}
      nativeFileMenu={isMac}
      exportGateway={exportGateway}
      interopExport={interopExportFacade}
      engineRef={engineRef}
      getGenerationLog={getGenerationLog}
      indexing={indexingFacade}
      agent={{
        session: agentSession,
        model: agentModelId,
        sessionStore,
        mentionItems,
        generation: generationFacade,
        executor,
        transcription: transcriptionFacade,
        newId: () => crypto.randomUUID(),
        settings: {
          keyConfig,
          falKeyConfig,
          llmModels: listLLMModels(),
          imageModels: listImageModels(),
          agentModel: agentModelId,
          imageModel: imageModelId,
          onAgentModelChange,
          onImageModelChange,
          mcp: window.desktopMcp ? {
            getStatus: () => window.desktopMcp!.getStatus(),
            setEnabled: (on) => window.desktopMcp!.setEnabled(on),
            regenerateToken: () => window.desktopMcp!.regenerateToken(),
          } : undefined,
        },
      }}
      onReady={(cmds) => {
        window.desktopProject?.onMenuCommand((c, arg) => {
          if (c === "open-recent") {
            cmds.openRecent(arg as import("@palmier/core").ProjectRef);
          } else if (c === "export") {
            cmds.export(arg as import("@palmier/ui").ExportKind | undefined);
          } else {
            const m: Record<string, () => void> = {
              "new": cmds.newProject,
              "open": cmds.open,
              "save": cmds.save,
              "save-as": cmds.saveAs,
            };
            m[c]?.();
          }
        });
      }}
    />
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("No #root element");

createRoot(root).render(
  <StrictMode>
    <PalmierDesktopApp />
  </StrictMode>,
);
