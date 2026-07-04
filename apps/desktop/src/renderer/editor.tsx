import { StrictMode, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { EditorStore, ProjectSession, defaultTimeline, SAMPLER_VERSION } from "@palmier/core";
import type { MediaManifestEntry } from "@palmier/core";
import "@palmier/ui/theme/tokens.css";
import { Editor, MediaLibrary, createEditorHost, localProjectStore, measureCaptionWidthFrac, MediaIndexingService, IndexingStatusRelay, createDomFrameTap, createDomOpenMedia, renderMattePng, encodeFrameJPEG, readConfirmThreshold, writeConfirmThreshold } from "@palmier/ui";
import type { KeyConfig, FalKeyConfig, MediaIndexingHost, MediaIndexingFacade } from "@palmier/ui";
import { AgentSession, ChatSessionStore, ToolExecutor, buildCatalog, toolsToMcp, ImageGenerator, GenerationService, listLLMModels, listImageModels, defaultLLMModel, defaultImageModel, MODEL_CATALOG, makeEntryUrl, TranscriptionService, EmbeddingService, createTransformersPipelines, LocalAsrService, createTransformersAsrPipelines, SkillStore, SkillCatalog, skillsSection } from "@palmier/ai";
import type { GenerationHost, StartJobArgs, TranscriptionHost, ToolContext } from "@palmier/ai";

declare global {
  interface Window {
    desktopMcp?: {
      setEnabled(on: boolean): Promise<{ enabled: boolean }>;
      getStatus(): Promise<{ enabled: boolean; running: boolean; url: string; token: string }>;
      regenerateToken(): Promise<string>;
      onBridgeRequest(cb: (msg: { id: number; kind: string; payload?: unknown }) => void): void;
      bridgeRespond(id: number, payload: { result?: unknown; error?: string }): void;
    };
    // M13B T1 project-nav registry (get_projects/open_project/new_project's desktop facade).
    // authorizePath's nonce (M13B final-review H-2) is minted main-side per in-flight MCP
    // callTool dispatch and threaded through by desktop-project-nav.ts — see its setAuthNonce.
    desktopProjectNav?: DesktopProjectNavBridge;
  }
}
import { DesktopGateway } from "./desktop-gateway.js";
import type { DesktopProjectRef } from "./desktop-gateway.js";
import { createDesktopProjectNav } from "./desktop-project-nav.js";
import type { DesktopProjectNavBridge, ProjectNavSession } from "./desktop-project-nav.js";
import { DesktopExportGateway } from "./desktop-export-gateway.js";
import { DesktopAiGateway } from "./desktop-ai-gateway.js";
import { DesktopGenGateway } from "./desktop-gen-gateway.js";
import { makeDesktopAudioExtractor } from "./desktop-audio-extract.js";
import { createDesktopMediaImport } from "./desktop-media-import.js";
import { createDesktopLut } from "./desktop-lut.js";
import { createDesktopInteropExport } from "./desktop-interop-export.js";
import { createDesktopSkillStorage, createDesktopSkillCatalogDeps } from "./desktop-skills.js";
import type { PlaybackEngine } from "@palmier/engine";
import { renderSpanToMp4 } from "@palmier/engine";

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

// Local whisper ASR runtime (M14A) — long-lived alongside the embedding service for the same
// reason: the weights are a one-time download, not per-project state. Lazy transformers import.
const localAsrService = new LocalAsrService(createTransformersAsrPipelines());
(window as unknown as Record<string, unknown>).__localAsrService = localAsrService;

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
    // The background transcript step (M14A T3): forceLocal through the CURRENT transcription
    // service ref so a project reopen's recreated service is picked up.
    transcription: { transcribe: (mediaRef, opts) => transcriptionServiceRef.current.transcribe(mediaRef, opts) },
    localAsr: localAsrService,
  });
}
const mediaIndexingServiceRef: { current: MediaIndexingService } = { current: makeMediaIndexingService() };
const indexingStatusRelay = new IndexingStatusRelay(mediaIndexingServiceRef.current);
// Resweeps on every library mutation (new imports/generations finalizing) — registered once on
// the (stable, never-recreated) library; always dereferences the CURRENT service via the ref.
library.subscribe(() => mediaIndexingServiceRef.current.start());

// The panel's "Download model" actions — the SAME services the tools' confirm gates drive, so a
// click here and a confirm:true tool call share one single-flight download per model.
const indexingFacade: MediaIndexingFacade = {
  getStatus: () => indexingStatusRelay.getStatus(),
  subscribe: (cb) => indexingStatusRelay.subscribe(cb),
  ensureEmbeddingReady: (onProgress) => embeddingService.ensureReady(onProgress),
  ensureAsrReady: (onProgress) => localAsrService.ensureReady(onProgress),
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
  current: new TranscriptionService(genGateway, transcriptionHost, audioExtractor, { local: localAsrService }),
};
(window as unknown as Record<string, unknown>).__transcriptionService = transcriptionServiceRef;

// SAME object threaded into the ToolExecutor context and the manual GenerationPanel — one facade, two callers.
const generationFacade = {
  hasKey: () => genGateway.hasKey(),
  addPlaceholder: (entry: MediaManifestEntry) => library.addPlaceholder(entry),
  startJob: (args: StartJobArgs) => generationServiceRef.current.startJob(args),
  entryUrl,
  // Settings-driven (replaces the old hardcoded 50) — read live so a Settings change takes
  // effect on the next call without recreating the facade.
  get confirmThreshold() {
    return readConfirmThreshold();
  },
  // generate_audio's video-to-audio span source (M14C T3) — the SAME headless export pipeline
  // the real export gateway drives (runExport), just silent (no audio) and shrunk to shortSide.
  renderSpanToMp4: (startFrame: number, frameCount: number, shortSide: number) =>
    renderSpanToMp4(store.getSnapshot().timeline, library.byteSource, { startFrame, frameCount, shortSide }),
  uploadFile: (bytes: Uint8Array, contentType: string, fileName: string) =>
    genGateway.uploadFile(bytes, contentType, fileName),
};

// Delegates through the ref (not a captured instance) so any future recreate is picked up.
const transcriptionFacade = {
  transcribe: (mediaRef: string, opts?: { language?: string }) => transcriptionServiceRef.current.transcribe(mediaRef, opts),
  cachedTranscript: (mediaRef: string) => transcriptionServiceRef.current.cachedTranscript(mediaRef),
  hasKey: () => transcriptionServiceRef.current.hasKey(),
  estimateCredits: (durationSeconds: number) => transcriptionServiceRef.current.estimateCredits(durationSeconds),
  // M14A: the keyless-local gate + the Captions tab's "Local — no credits used" copy.
  localReady: () => localAsrService.state === "ready",
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

// renderMatte (M13A T1, create_matte) is wired here rather than inside createDesktopMediaImport:
// it's pure canvas rendering with no host-specific I/O, so it's the same @palmier/ui function on
// both hosts — spread on top of the desktop-specific fromBytes/fromUrl/fromPath facade.
const mediaImportFacade = { ...createDesktopMediaImport({
  library,
  getProjectDir: () => (session.getState().ref as DesktopProjectRef | null)?.path,
}), renderMatte: renderMattePng };

// SAME object threaded into the ToolExecutor context and useExportCommand's XML/FCPXML path —
// mirrors the generation/transcription/library facade pattern above.
const interopExportFacade = createDesktopInteropExport({
  resolvePath: resolveMediaPath,
  getProjectDir: () => (session.getState().ref as DesktopProjectRef | null)?.path,
});

// Project navigation facade (M13B T1, get_projects/open_project/new_project) — desktop only, over
// window.desktopProjectNav (the main-process registry) + the session (auto-save/open/create-as).
// Restore-on-failed-create, the no-picker-hang guard, and authorize-nonce threading (M13B
// final-review H-1/M-1/H-2) live in desktop-project-nav.ts, where they're unit-testable.
// ProjectSession.getState().ref is the generic ProjectRef; desktop's is always a DesktopProjectRef
// under the hood (DesktopGateway only ever mints refs via refFor) — same cast the old inline code used.
const projectNavSession: ProjectNavSession = {
  isDirty: () => session.isDirty(),
  getState: () => session.getState() as { ref: DesktopProjectRef | null; name: string },
  save: () => session.save(),
  newProject: (confirm) => session.newProject(confirm),
  saveAs: (ref) => session.saveAs(ref),
  open: (confirm, ref) => session.open(confirm, ref),
};
const projectNav = window.desktopProjectNav ? createDesktopProjectNav(projectNavSession, window.desktopProjectNav) : undefined;
const projectsFacade: ToolContext["projects"] = projectNav?.facade;

// Skills (M15 T2) — ~/.palmier/skills over the main-process fs IPC; the community catalog cache
// lives in userData. Reload once at bootstrap (mirrors Swift's SkillStore.init()); the agent's
// per-run reload happens via getSkillsSuffix below.
const skillStore = new SkillStore(createDesktopSkillStorage());
const skillCatalog = new SkillCatalog(createDesktopSkillCatalogDeps());
void skillStore.reload();
(window as unknown as Record<string, unknown>).__skillStore = skillStore;
(window as unknown as Record<string, unknown>).__skillCatalog = skillCatalog;

const toolContext: ToolContext = {
  store,
  getManifest: () => library.getManifest(),
  newId: () => crypto.randomUUID(),
  generateImage: (input) => imageGenerator.generate(input),
  renderFrame: async (atFrame: number, opts?: { maxEdge?: number; jpegQuality?: number }) => {
    const engine = engineRef.current;
    if (!engine) throw new Error("Engine not ready");
    await engine.seek(atFrame, "exact");
    const rgba = await engine.readRGBA();
    const { width, height } = engine;
    if (!opts) return { rgba, width, height };
    const jpegBase64 = await encodeFrameJPEG(rgba, width, height, opts);
    return { rgba, width, height, jpegBase64 };
  },
  generation: generationFacade,
  transcription: transcriptionFacade,
  embedding: embeddingFacade,
  library: libraryFacade,
  mediaImport: mediaImportFacade,
  interopExport: interopExportFacade,
  projectName: () => session.getState().name,
  lut: createDesktopLut(library),
};
// In-app agent: never the project-nav ones (see buildCatalog's "inApp" default); ctx.skills only
// goes into THIS context — the MCP one below never gets a `skills` key (M15 T2 guard).
const executor = new ToolExecutor(buildCatalog(), { ...toolContext, skills: { body: (id) => skillStore.body(id) } });
// MCP server only: + get_projects/open_project/new_project — projects facade added here only.
const mcpExecutor = new ToolExecutor(buildCatalog("mcp"), { ...toolContext, projects: projectsFacade });
const agentSession = new AgentSession({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  gateway: agentGateway as any,
  executor,
  tools: buildCatalog(),
  model: initialAgentModel,
  getSkillsSuffix: async () => {
    await skillStore.reload();
    return skillsSection(skillStore.skillIndex);
  },
});

const sessionStore = new ChatSessionStore(localProjectStore("palmier.chats"));

// Build mention items from the library's media entries
const mentionItems = library.getManifest().entries.map((e) => ({
  id: e.id,
  label: e.name,
  kind: "media" as const,
  contextText: `@media ${e.name} (${e.type}, ${e.duration}s, id=${e.id})`,
}));

// Register MCP bridge handler (main↔renderer IPC) — mcpExecutor (43 tools: the 40 shared + the 3
// project-nav) backs the MCP server; the in-app agent keeps the 41-tool executor above (the 40
// shared + read_skill) — see catalog.ts's buildCatalog for the authoritative counts.
window.desktopMcp?.onBridgeRequest(async ({ id, kind, payload }) => {
  try {
    let result: unknown;
    if (kind === "listTools") {
      result = toolsToMcp(mcpExecutor.list());
    } else if (kind === "callTool") {
      // H-2: the nonce main's mcpBridge minted for this forward — threaded through so
      // openProjectAtPath's authorizePath call can prove it's happening inside a live MCP call.
      const p = payload as { name: string; args: unknown; __authNonce?: string };
      projectNav?.setAuthNonce(p.__authNonce ?? null);
      try {
        result = await mcpExecutor.execute(p.name, p.args);
      } finally {
        projectNav?.setAuthNonce(null);
      }
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
  const [confirmThreshold, setConfirmThreshold] = useState(() => readConfirmThreshold());

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

  function onConfirmThresholdChange(value: number) {
    setConfirmThreshold(value);
    writeConfirmThreshold(value);
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
          confirmThreshold,
          onConfirmThresholdChange,
          mcp: window.desktopMcp ? {
            getStatus: () => window.desktopMcp!.getStatus(),
            setEnabled: (on) => window.desktopMcp!.setEnabled(on),
            regenerateToken: () => window.desktopMcp!.regenerateToken(),
          } : undefined,
          skills: { store: skillStore, catalog: skillCatalog },
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
