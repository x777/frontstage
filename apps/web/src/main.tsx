import { StrictMode, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { EditorStore, ProjectSession, SAMPLER_VERSION } from "@frontstage/core";
import type { GenerationLogEntry } from "@frontstage/core";
import type { PlaybackEngine } from "@frontstage/engine";
import { renderSpanToMp4 } from "@frontstage/engine";
import "@frontstage/ui/theme/tokens.css";
import { restoreLayout, createEditorHost, localProjectStore, measureCaptionWidthFrac, MediaIndexingService, IndexingStatusRelay, createDomFrameTap, createDomOpenMedia, renderMattePng, encodeFrameJPEG, readConfirmThreshold, writeConfirmThreshold } from "@frontstage/ui";
import type { KeyConfig, FalKeyConfig, RelayConfig, GenerationFacade, MediaIndexingHost, MediaIndexingFacade } from "@frontstage/ui";
import { AgentSession, ChatSessionStore, ToolExecutor, buildCatalog, ImageGenerator, GenerationService, listLLMModels, listImageModels, defaultLLMModel, defaultImageModel, makeEntryUrl, TranscriptionService, EmbeddingService, createTransformersPipelines, LocalAsrService, createTransformersAsrPipelines, SkillStore, SkillCatalog, skillsSection } from "@frontstage/ai";
import type { GenerationHost, TranscriptionHost, ToolContext, ToolResult } from "@frontstage/ai";
import { App } from "./App.js";
import { sampleTimeline, buildSampleLibrary } from "./sample-project.js";
import { WebGateway } from "./web-gateway.js";
import { WebExportGateway } from "./web-export.js";
import { createWebInteropExport } from "./web-interop-export.js";
import { WebAiGateway } from "./web-ai-gateway.js";
import { WebGenGateway } from "./web-gen-gateway.js";
import { makeWebAudioExtractor } from "./web-audio-extract.js";
import { createWebMediaImport } from "./web-media-import.js";
import { createWebSkillStorage, createWebSkillCatalogDeps } from "./web-skills.js";
import { getRelayOrigin, getUserKeys, setUserKeys, fetchMe, loginUrl, logout } from "./relay-config.js";
import "./web-fs-test-entry.js";

// Build-time flag set by the site build script (T3) — the deployed cloud site opts into relay
// mode; every other build (self-host, desktop, local dev) keeps today's self-hosted proxy mode.
const RELAY_MODE = (import.meta.env.VITE_RELAY_MODE as string | undefined) === "1";

interface FrontstageAppProps {
  store: EditorStore;
  session: ProjectSession;
  library: Awaited<ReturnType<typeof buildSampleLibrary>>;
  exportGateway: WebExportGateway;
  interopExport: NonNullable<ToolContext["interopExport"]>;
  agentSession: AgentSession;
  imageGenerator: ImageGenerator;
  sessionStore: ChatSessionStore;
  mentionItems: { id: string; label: string; kind: "media"; contextText: string }[];
  aiProxyUrl: string;
  engineRef: { current: PlaybackEngine | null };
  getGenerationLog: () => GenerationLogEntry[];
  genGateway: WebGenGateway;
  generationFacade: GenerationFacade;
  executor: { execute(name: string, args: unknown): Promise<ToolResult> };
  transcriptionFacade: NonNullable<ToolContext["transcription"]>;
  indexing: MediaIndexingFacade;
  skillStore: SkillStore;
  skillCatalog: SkillCatalog;
}

function FrontstageApp({ store, session, library, exportGateway, interopExport, agentSession, imageGenerator, sessionStore, mentionItems, aiProxyUrl, engineRef, getGenerationLog, genGateway, generationFacade, executor, transcriptionFacade, indexing, skillStore, skillCatalog }: FrontstageAppProps) {
  const [agentModel, setAgentModel] = useState(() => localStorage.getItem("frontstage.agent.model") ?? defaultLLMModel());
  const [imageModel, setImageModel] = useState(() => localStorage.getItem("frontstage.image.model") ?? defaultImageModel());
  const [proxyUrl, setProxyUrl] = useState(() => localStorage.getItem("frontstage.ai.proxyUrl") ?? aiProxyUrl);
  const [falEnabled, setFalEnabled] = useState(false);
  const [confirmThreshold, setConfirmThreshold] = useState(() => readConfirmThreshold());
  const [relayUser, setRelayUser] = useState<{ id: string; name: string; provider: string } | null>(null);
  const [relayFalKey, setRelayFalKey] = useState(() => getUserKeys().falKey ?? "");
  const [relayOpenRouterKey, setRelayOpenRouterKey] = useState(() => getUserKeys().openRouterKey ?? "");

  useEffect(() => {
    genGateway.hasKey().then(setFalEnabled).catch(() => setFalEnabled(false));
  }, [genGateway]);

  useEffect(() => {
    if (!RELAY_MODE) return;
    fetchMe().then(setRelayUser).catch(() => setRelayUser(null));
  }, []);

  // Shared by the top-bar affordance and the AI-panel login gates — a full-page redirect into the
  // OAuth consent flow (mirrors SettingsPanel's RelayAuthPane).
  function handleRelaySignIn(provider: "google" | "github") {
    window.location.href = loginUrl(provider);
  }

  function handleSaveRelayKeys(keys: { falKey?: string; openRouterKey?: string }) {
    setUserKeys(keys);
    if (keys.falKey !== undefined) setRelayFalKey(keys.falKey);
    if (keys.openRouterKey !== undefined) setRelayOpenRouterKey(keys.openRouterKey);
    genGateway.hasKey().then(setFalEnabled).catch(() => setFalEnabled(false));
  }

  function onAgentModelChange(id: string) {
    setAgentModel(id);
    agentSession.setModel(id);
    localStorage.setItem("frontstage.agent.model", id);
  }

  function onImageModelChange(id: string) {
    setImageModel(id);
    imageGenerator.setModel(id);
    localStorage.setItem("frontstage.image.model", id);
  }

  function onConfirmThresholdChange(value: number) {
    setConfirmThreshold(value);
    writeConfirmThreshold(value);
  }

  const keyConfig: KeyConfig = {
    kind: "proxy",
    proxyUrl,
    proxyToken: localStorage.getItem("frontstage.ai.proxyToken") ?? undefined,
    // Proxy auth token (NOT the OpenRouter key — that lives only on the self-hosted proxy). Browser-resident by design for the BYO self-host model; scoped to a user-controlled endpoint.
    onSave: (url, token) => {
      localStorage.setItem("frontstage.ai.proxyUrl", url);
      setProxyUrl(url);
      if (token) localStorage.setItem("frontstage.ai.proxyToken", token);
      else localStorage.removeItem("frontstage.ai.proxyToken");
    },
  };

  const falKeyConfig: FalKeyConfig = { kind: "proxyInfo", enabled: falEnabled };

  const relayConfig: RelayConfig | undefined = RELAY_MODE
    ? {
        auth: relayUser
          ? {
              status: "signedIn",
              user: { name: relayUser.name, provider: relayUser.provider },
              onLogout: () => { logout().finally(() => setRelayUser(null)); },
            }
          : { status: "signedOut", loginUrl },
        falKey: relayFalKey,
        openRouterKey: relayOpenRouterKey,
        onSaveKeys: handleSaveRelayKeys,
      }
    : undefined;

  // Visible sign-in (M18C T3): the top-bar affordance and the AI panels' login gates, both driven
  // by the same fetchMe() state as relayConfig above.
  const relayAuth = RELAY_MODE
    ? { user: relayUser ? { name: relayUser.name, provider: relayUser.provider } : null, onSignIn: handleRelaySignIn }
    : undefined;
  const relayGate = RELAY_MODE ? { signedIn: relayUser !== null, onSignIn: handleRelaySignIn } : undefined;

  return (
    <App
      store={store}
      media={library.byteSource}
      library={library}
      session={session}
      exportGateway={exportGateway}
      interopExport={interopExport}
      engineRef={engineRef}
      getGenerationLog={getGenerationLog}
      indexing={indexing}
      relayAuth={relayAuth}
      agent={{
        session: agentSession,
        model: agentModel,
        sessionStore,
        mentionItems,
        generation: generationFacade,
        executor,
        transcription: transcriptionFacade,
        newId: () => crypto.randomUUID(),
        settings: {
          keyConfig,
          falKeyConfig,
          relay: relayConfig,
          llmModels: listLLMModels(),
          imageModels: listImageModels(),
          agentModel,
          imageModel,
          onAgentModelChange,
          onImageModelChange,
          confirmThreshold,
          onConfirmThresholdChange,
          skills: { store: skillStore, catalog: skillCatalog },
        },
        relayGate,
      }}
    />
  );
}

async function bootstrap() {
  const store = new EditorStore(sampleTimeline());
  restoreLayout(store);

  const library = await buildSampleLibrary();

  // If __pickDirectory is injected (e2e seam), use it; otherwise real showDirectoryPicker.
  const pickDirectory = (window as any).__pickDirectory as
    | ((opts?: { mode?: "read" | "readwrite" }) => Promise<FileSystemDirectoryHandle | null>)
    | undefined;
  const gateway = new WebGateway(pickDirectory ? { pickDirectory } : undefined);
  const { host, wrappedGateway, appendGenerationLog, getGenerationLog } = createEditorHost(store, library, gateway);
  const session = new ProjectSession(host, wrappedGateway);

  // Construct WebAiGateway; proxy URL from test-seam or env.
  const aiProxyUrl =
    (window as unknown as Record<string, unknown>).__aiProxyUrl as string | undefined ??
    (import.meta.env.VITE_AI_PROXY_URL as string | undefined) ??
    "http://localhost:8787";
  const aiProxyToken =
    (window as unknown as Record<string, unknown>).__aiProxyToken as string | undefined ??
    (import.meta.env.VITE_AI_PROXY_TOKEN as string | undefined);
  const webAiGateway = RELAY_MODE
    ? new WebAiGateway({ origin: getRelayOrigin(), getKeys: getUserKeys })
    : new WebAiGateway(aiProxyUrl, aiProxyToken);
  (window as unknown as Record<string, unknown>).__webAiGateway = webAiGateway;

  // If __pickSaveFile is injected (e2e seam), use it; otherwise real showSaveFilePicker.
  const pickSaveFile = (window as any).__pickSaveFile as
    | ((suggestedName: string) => Promise<FileSystemFileHandle | null>)
    | undefined;
  const exportGateway = new WebExportGateway(pickSaveFile ? { pickSaveFile } : undefined);

  // SAME facade threaded into the ToolExecutor context and the UI's XML/FCPXML export path.
  const interopExportFacade = createWebInteropExport(
    pickSaveFile ? { pickSaveFile: (name) => pickSaveFile(name) } : undefined,
  );

  // Build agent session — __aiGateway seam takes precedence (e2e injects a fake)
  const agentGateway = (window as unknown as Record<string, unknown>).__aiGateway ?? webAiGateway;
  const initialAgentModel = localStorage.getItem("frontstage.agent.model") ?? defaultLLMModel();
  const initialImageModel = localStorage.getItem("frontstage.image.model") ?? defaultImageModel();
  const imageGenerator = new ImageGenerator({
    gateway: agentGateway as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    host: { addMedia: (e, b) => library.addEntry(e, b), appendGenerationLog },
    model: initialImageModel,
  });
  (window as unknown as Record<string, unknown>).__imageGenerator = imageGenerator;

  // Skills (M15 T2) — OPFS-backed; the community catalog cache lives in localStorage. Reload once
  // at bootstrap (mirrors Swift's SkillStore.init()); the agent's per-run reload happens via
  // getSkillsSuffix below.
  const skillStore = new SkillStore(createWebSkillStorage());
  const skillCatalog = new SkillCatalog(createWebSkillCatalogDeps());
  await skillStore.reload();
  (window as unknown as Record<string, unknown>).__skillStore = skillStore;
  (window as unknown as Record<string, unknown>).__skillCatalog = skillCatalog;

  // Generation orchestrator (image/video jobs) — routed through the self-hosted proxy (fal key
  // never in browser) or, in relay mode, through the cloud relay with the browser-resident key header.
  const genGateway = RELAY_MODE
    ? new WebGenGateway({ origin: getRelayOrigin(), getKeys: getUserKeys })
    : new WebGenGateway(aiProxyUrl, aiProxyToken);
  const generationHost: GenerationHost = {
    addPlaceholder: (entry) => library.addPlaceholder(entry),
    patchEntry: (id, patch) => library.patchEntry(id, patch),
    finalizeGenerated: (id, bytes) => library.finalizeGeneratedProbed(id, bytes),
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
  (window as unknown as Record<string, unknown>).__mediaIndexingService = mediaIndexingServiceRef;

  // The panel's "Download model" actions — the SAME services the tools' confirm gates drive, so a
  // click here and a confirm:true tool call share one single-flight download per model.
  const indexingFacade: MediaIndexingFacade = {
    getStatus: () => indexingStatusRelay.getStatus(),
    subscribe: (cb) => indexingStatusRelay.subscribe(cb),
    ensureEmbeddingReady: (onProgress) => embeddingService.ensureReady(onProgress),
    ensureAsrReady: (onProgress) => localAsrService.ensureReady(onProgress),
  };

  // SAME object threaded into the ToolExecutor context; T4 wires the real visual search scope +
  // the model-download confirm gate on top of ready()/ensureReady(). cachedEmbeddings delegates
  // through the indexing service ref so it always reads the current project's cache.
  const embeddingFacade = {
    ready: () => embeddingService.state === "ready",
    ensureReady: (onProgress?: (p: { loaded: number; total: number }) => void) => embeddingService.ensureReady(onProgress),
    embedText: (q: string) => embeddingService.embedText(q),
    cachedEmbeddings: (mediaRef: string) => mediaIndexingServiceRef.current.cachedEmbeddings(mediaRef),
    modelInfo: embeddingService.info,
  };

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
  const audioExtractor = makeWebAudioExtractor({ openBlob: (mediaRef) => library.byteSource.open(mediaRef) });
  const transcriptionServiceRef: { current: TranscriptionService } = {
    current: new TranscriptionService(genGateway, transcriptionHost, audioExtractor, { local: localAsrService }),
  };
  (window as unknown as Record<string, unknown>).__transcriptionService = transcriptionServiceRef;

  // SAME object threaded into the ToolExecutor context and the manual GenerationPanel — one facade, two callers.
  const generationFacade: GenerationFacade = {
    hasKey: () => genGateway.hasKey(),
    addPlaceholder: (entry) => library.addPlaceholder(entry),
    startJob: (args) => generationServiceRef.current.startJob(args),
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

  // Reads localStorage at call time (not just the bootstrap-time aiProxyUrl) so a proxy URL/token
  // change in Settings takes effect without a reload — mirrors keyConfig's persistence keys above.
  // renderMatte (M13A T1, create_matte) is wired here rather than inside createWebMediaImport:
  // it's pure canvas rendering with no host-specific I/O, so it's the same @frontstage/ui function on
  // both hosts — spread on top of the web-specific fromBytes/fromUrl facade.
  const mediaImportFacade = { ...createWebMediaImport(
    RELAY_MODE
      ? { library, relayOrigin: () => getRelayOrigin() }
      : {
          library,
          proxyUrl: () => localStorage.getItem("frontstage.ai.proxyUrl") ?? aiProxyUrl,
          proxyToken: () => localStorage.getItem("frontstage.ai.proxyToken") ?? undefined,
        },
  ), renderMatte: renderMattePng };

  const engineRef: { current: PlaybackEngine | null } = { current: null };
  const executor = new ToolExecutor(buildCatalog(), {
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
    // .cube LUT persistence (M14C T2): store() is cross-platform; readLocalFile is desktop-only
    // (no arbitrary local-path fs access in a browser) — apply_color's lut.path errors cleanly here.
    lut: { store: (filename, bytes) => library.storeLut(filename, bytes) },
    // Skills (M15 T2) — web has no MCP path, so ctx.skills goes straight into the one shared context.
    skills: { body: (id) => skillStore.body(id) },
  });
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

  const sessionStore = new ChatSessionStore(localProjectStore("frontstage.chats"));

  // Build mention items from the library's media entries
  const mentionItems = library.getManifest().entries.map((e) => ({
    id: e.id,
    label: e.name,
    kind: "media" as const,
    contextText: `@media ${e.name} (${e.type}, ${e.duration}s, id=${e.id})`,
  }));

  // Expose for E2E tests
  (window as unknown as Record<string, unknown>).__frontstageStore = store;
  (window as unknown as Record<string, unknown>).__mediaLibrary = library;
  (window as unknown as Record<string, unknown>).__projectSession = session;
  (window as unknown as Record<string, unknown>).__projectGateway = gateway;
  (window as unknown as Record<string, unknown>).__webExportGateway = exportGateway;
  (window as unknown as Record<string, unknown>).__agentSession = agentSession;

  const root = document.getElementById("root");
  if (!root) throw new Error("No #root element");
  createRoot(root).render(
    <StrictMode>
      <FrontstageApp
        store={store}
        session={session}
        library={library}
        exportGateway={exportGateway}
        interopExport={interopExportFacade}
        agentSession={agentSession}
        imageGenerator={imageGenerator}
        sessionStore={sessionStore}
        mentionItems={mentionItems}
        aiProxyUrl={aiProxyUrl}
        engineRef={engineRef}
        getGenerationLog={getGenerationLog}
        genGateway={genGateway}
        generationFacade={generationFacade}
        executor={executor}
        transcriptionFacade={transcriptionFacade}
        indexing={indexingFacade}
        skillStore={skillStore}
        skillCatalog={skillCatalog}
      />
    </StrictMode>,
  );
}

bootstrap().catch((err) => {
  console.error("Bootstrap failed:", err);
  const root = document.getElementById("root");
  if (root) {
    const wrapper = document.createElement("div");
    Object.assign(wrapper.style, { padding: "2rem", fontFamily: "monospace", color: "#c00" });

    const heading = document.createElement("strong");
    heading.textContent = "Failed to start Frontstage";

    const detail = document.createElement("pre");
    Object.assign(detail.style, { marginTop: "1rem", whiteSpace: "pre-wrap" });
    detail.textContent = String(err);

    const hint = document.createElement("p");
    Object.assign(hint.style, { marginTop: "1rem", color: "#666" });
    hint.textContent = "Check the console for details. Reload to retry.";

    wrapper.append(heading, detail, hint);
    root.append(wrapper);
  }
});
