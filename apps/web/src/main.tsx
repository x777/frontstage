import { StrictMode, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { EditorStore, ProjectSession } from "@palmier/core";
import type { GenerationLogEntry } from "@palmier/core";
import type { PlaybackEngine } from "@palmier/engine";
import "@palmier/ui/theme/tokens.css";
import { restoreLayout, createEditorHost, localProjectStore } from "@palmier/ui";
import type { KeyConfig, FalKeyConfig, GenerationFacade } from "@palmier/ui";
import { AgentSession, ChatSessionStore, ToolExecutor, buildCatalog, ImageGenerator, GenerationService, listLLMModels, listImageModels, defaultLLMModel, defaultImageModel, makeEntryUrl, TranscriptionService } from "@palmier/ai";
import type { GenerationHost, TranscriptionHost } from "@palmier/ai";
import { App } from "./App.js";
import { sampleTimeline, buildSampleLibrary } from "./sample-project.js";
import { WebGateway } from "./web-gateway.js";
import { WebExportGateway } from "./web-export.js";
import { WebAiGateway } from "./web-ai-gateway.js";
import { WebGenGateway } from "./web-gen-gateway.js";
import { makeWebAudioExtractor } from "./web-audio-extract.js";
import "./web-fs-test-entry.js";

interface PalmierAppProps {
  store: EditorStore;
  session: ProjectSession;
  library: Awaited<ReturnType<typeof buildSampleLibrary>>;
  exportGateway: WebExportGateway;
  agentSession: AgentSession;
  imageGenerator: ImageGenerator;
  sessionStore: ChatSessionStore;
  mentionItems: { id: string; label: string; kind: "media"; contextText: string }[];
  aiProxyUrl: string;
  engineRef: { current: PlaybackEngine | null };
  getGenerationLog: () => GenerationLogEntry[];
  genGateway: WebGenGateway;
  generationFacade: GenerationFacade;
}

function PalmierApp({ store, session, library, exportGateway, agentSession, imageGenerator, sessionStore, mentionItems, aiProxyUrl, engineRef, getGenerationLog, genGateway, generationFacade }: PalmierAppProps) {
  const [agentModel, setAgentModel] = useState(() => localStorage.getItem("palmier.agent.model") ?? defaultLLMModel());
  const [imageModel, setImageModel] = useState(() => localStorage.getItem("palmier.image.model") ?? defaultImageModel());
  const [proxyUrl, setProxyUrl] = useState(() => localStorage.getItem("palmier.ai.proxyUrl") ?? aiProxyUrl);
  const [falEnabled, setFalEnabled] = useState(false);

  useEffect(() => {
    genGateway.hasKey().then(setFalEnabled).catch(() => setFalEnabled(false));
  }, [genGateway]);

  function onAgentModelChange(id: string) {
    setAgentModel(id);
    agentSession.setModel(id);
    localStorage.setItem("palmier.agent.model", id);
  }

  function onImageModelChange(id: string) {
    setImageModel(id);
    imageGenerator.setModel(id);
    localStorage.setItem("palmier.image.model", id);
  }

  const keyConfig: KeyConfig = {
    kind: "proxy",
    proxyUrl,
    proxyToken: localStorage.getItem("palmier.ai.proxyToken") ?? undefined,
    // Proxy auth token (NOT the OpenRouter key — that lives only on the self-hosted proxy). Browser-resident by design for the BYO self-host model; scoped to a user-controlled endpoint.
    onSave: (url, token) => {
      localStorage.setItem("palmier.ai.proxyUrl", url);
      setProxyUrl(url);
      if (token) localStorage.setItem("palmier.ai.proxyToken", token);
      else localStorage.removeItem("palmier.ai.proxyToken");
    },
  };

  const falKeyConfig: FalKeyConfig = { kind: "proxyInfo", enabled: falEnabled };

  return (
    <App
      store={store}
      media={library.byteSource}
      library={library}
      session={session}
      exportGateway={exportGateway}
      engineRef={engineRef}
      getGenerationLog={getGenerationLog}
      agent={{
        session: agentSession,
        model: agentModel,
        sessionStore,
        mentionItems,
        generation: generationFacade,
        newId: () => crypto.randomUUID(),
        settings: {
          keyConfig,
          falKeyConfig,
          llmModels: listLLMModels(),
          imageModels: listImageModels(),
          agentModel,
          imageModel,
          onAgentModelChange,
          onImageModelChange,
        },
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
  const webAiGateway = new WebAiGateway(aiProxyUrl, aiProxyToken);
  (window as unknown as Record<string, unknown>).__webAiGateway = webAiGateway;

  // If __pickSaveFile is injected (e2e seam), use it; otherwise real showSaveFilePicker.
  const pickSaveFile = (window as any).__pickSaveFile as
    | ((suggestedName: string) => Promise<FileSystemFileHandle | null>)
    | undefined;
  const exportGateway = new WebExportGateway(pickSaveFile ? { pickSaveFile } : undefined);

  // Build agent session — __aiGateway seam takes precedence (e2e injects a fake)
  const agentGateway = (window as unknown as Record<string, unknown>).__aiGateway ?? webAiGateway;
  const initialAgentModel = localStorage.getItem("palmier.agent.model") ?? defaultLLMModel();
  const initialImageModel = localStorage.getItem("palmier.image.model") ?? defaultImageModel();
  const imageGenerator = new ImageGenerator({
    gateway: agentGateway as any, // eslint-disable-line @typescript-eslint/no-explicit-any
    host: { addMedia: (e, b) => library.addEntry(e, b), appendGenerationLog },
    model: initialImageModel,
  });
  (window as unknown as Record<string, unknown>).__imageGenerator = imageGenerator;

  // Generation orchestrator (image/video jobs) — routed through the self-hosted proxy (fal key never in browser).
  const genGateway = new WebGenGateway(aiProxyUrl, aiProxyToken);
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

  // Every successful open resumes in-flight jobs from the loaded manifest;
  // dispose+recreate first since there's no separate "close project" action.
  session.onOpened = () => {
    generationServiceRef.current.dispose();
    generationServiceRef.current = new GenerationService(genGateway, generationHost);
    generationServiceRef.current.resumePending();
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
    current: new TranscriptionService(genGateway, transcriptionHost, audioExtractor),
  };
  (window as unknown as Record<string, unknown>).__transcriptionService = transcriptionServiceRef;

  // SAME object threaded into the ToolExecutor context and the manual GenerationPanel — one facade, two callers.
  const generationFacade: GenerationFacade = {
    hasKey: () => genGateway.hasKey(),
    addPlaceholder: (entry) => library.addPlaceholder(entry),
    startJob: (args) => generationServiceRef.current.startJob(args),
    entryUrl,
    confirmThreshold: 50,
  };

  // Delegates through the ref (not a captured instance) so any future recreate is picked up.
  const transcriptionFacade = {
    transcribe: (mediaRef: string, opts?: { language?: string }) => transcriptionServiceRef.current.transcribe(mediaRef, opts),
    cachedTranscript: (mediaRef: string) => transcriptionServiceRef.current.cachedTranscript(mediaRef),
    hasKey: () => transcriptionServiceRef.current.hasKey(),
    estimateCredits: (durationSeconds: number) => transcriptionServiceRef.current.estimateCredits(durationSeconds),
  };

  const engineRef: { current: PlaybackEngine | null } = { current: null };
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

  // Expose for E2E tests
  (window as unknown as Record<string, unknown>).__palmierStore = store;
  (window as unknown as Record<string, unknown>).__mediaLibrary = library;
  (window as unknown as Record<string, unknown>).__projectSession = session;
  (window as unknown as Record<string, unknown>).__projectGateway = gateway;
  (window as unknown as Record<string, unknown>).__webExportGateway = exportGateway;
  (window as unknown as Record<string, unknown>).__agentSession = agentSession;

  const root = document.getElementById("root");
  if (!root) throw new Error("No #root element");
  createRoot(root).render(
    <StrictMode>
      <PalmierApp
        store={store}
        session={session}
        library={library}
        exportGateway={exportGateway}
        agentSession={agentSession}
        imageGenerator={imageGenerator}
        sessionStore={sessionStore}
        mentionItems={mentionItems}
        aiProxyUrl={aiProxyUrl}
        engineRef={engineRef}
        getGenerationLog={getGenerationLog}
        genGateway={genGateway}
        generationFacade={generationFacade}
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
    heading.textContent = "Failed to start PalmierPro";

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
