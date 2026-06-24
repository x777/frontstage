import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { EditorStore, ProjectSession, defaultTimeline } from "@palmier/core";
import "@palmier/ui/theme/tokens.css";
import { Editor, MediaLibrary, createEditorHost } from "@palmier/ui";
import { AgentSession, ChatSessionStore, ToolExecutor, buildCatalog, ImageGenerator } from "@palmier/ai";
import { DesktopGateway } from "./desktop-gateway.js";
import { DesktopExportGateway } from "./desktop-export-gateway.js";
import { DesktopAiGateway } from "./desktop-ai-gateway.js";

const store = new EditorStore(defaultTimeline());
const library = new MediaLibrary();
const gateway = new DesktopGateway();
const { host, wrappedGateway } = createEditorHost(store, library, gateway);
const session = new ProjectSession(host, wrappedGateway);
const exportGateway = new DesktopExportGateway();

// Build agent session — __aiGateway seam takes precedence (e2e injects a fake)
const _desktopAiGateway = new DesktopAiGateway();
const agentGateway = (window as unknown as Record<string, unknown>).__aiGateway ?? _desktopAiGateway;
const agentModel = "anthropic/claude-sonnet-4-6";
const imageGenerator = new ImageGenerator({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  gateway: agentGateway as any,
  host: { addMedia: (e, b) => library.addEntry(e, b) },
  model: agentModel,
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
  model: agentModel,
});

// Build session store (in-memory ProjectStore — project-bound persistence is 6.6 polish)
const _memStore = new Map<string, string>();
const _inMemoryProjectStore = {
  readText: async (key: string) => _memStore.get(key) ?? null,
  writeText: async (key: string, value: string) => { _memStore.set(key, value); },
};
const sessionStore = new ChatSessionStore(_inMemoryProjectStore);

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

const root = document.getElementById("root");
if (!root) throw new Error("No #root element");

createRoot(root).render(
  <StrictMode>
    <Editor
      store={store}
      media={library.byteSource}
      library={library}
      session={session}
      exportGateway={exportGateway}
      agent={{ session: agentSession, model: agentModel, sessionStore, mentionItems, imageGenerator }}
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
  </StrictMode>,
);
