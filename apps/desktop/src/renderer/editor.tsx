import { StrictMode, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { EditorStore, ProjectSession, defaultTimeline } from "@palmier/core";
import "@palmier/ui/theme/tokens.css";
import { Editor, MediaLibrary, createEditorHost, localProjectStore } from "@palmier/ui";
import type { KeyConfig } from "@palmier/ui";
import { AgentSession, ChatSessionStore, ToolExecutor, buildCatalog, ImageGenerator, listLLMModels, listImageModels, defaultLLMModel, defaultImageModel } from "@palmier/ai";
import { DesktopGateway } from "./desktop-gateway.js";
import { DesktopExportGateway } from "./desktop-export-gateway.js";
import { DesktopAiGateway } from "./desktop-ai-gateway.js";

const store = new EditorStore(defaultTimeline());
const library = new MediaLibrary();
const gateway = new DesktopGateway();
const { host, wrappedGateway, appendGenerationLog } = createEditorHost(store, library, gateway);
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
const executor = new ToolExecutor(buildCatalog(), {
  store,
  getManifest: () => library.getManifest(),
  newId: () => crypto.randomUUID(),
  generateImage: (input) => imageGenerator.generate(input),
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
(window as unknown as Record<string, unknown>).__desktopGateway = gateway;
(window as unknown as Record<string, unknown>).__agentSession = agentSession;

function PalmierDesktopApp() {
  const [agentModelId, setAgentModelId] = useState(() => localStorage.getItem("palmier.agent.model") ?? defaultLLMModel());
  const [imageModelId, setImageModelId] = useState(() => localStorage.getItem("palmier.image.model") ?? defaultImageModel());
  const [hasKey, setHasKey] = useState(false);

  useEffect(() => {
    window.desktopAI?.hasKey().then(setHasKey).catch(() => {});
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

  return (
    <Editor
      store={store}
      media={library.byteSource}
      library={library}
      session={session}
      exportGateway={exportGateway}
      agent={{
        session: agentSession,
        model: agentModelId,
        sessionStore,
        mentionItems,
        imageGenerator,
        settings: {
          keyConfig,
          llmModels: listLLMModels(),
          imageModels: listImageModels(),
          agentModel: agentModelId,
          imageModel: imageModelId,
          onAgentModelChange,
          onImageModelChange,
        },
      }}
      onReady={(cmds) => {
        window.desktopProject?.onMenuCommand((c, arg) => {
          if (c === "open-recent") {
            cmds.openRecent(arg as import("@palmier/core").ProjectRef);
          } else {
            const m: Record<string, () => void> = {
              "new": cmds.newProject,
              "open": cmds.open,
              "save": cmds.save,
              "save-as": cmds.saveAs,
              "export": cmds.export,
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
