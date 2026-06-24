import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { EditorStore, ProjectSession, defaultTimeline } from "@palmier/core";
import "@palmier/ui/theme/tokens.css";
import { Editor, MediaLibrary, createEditorHost } from "@palmier/ui";
import { AgentSession, ToolExecutor, buildCatalog } from "@palmier/ai";
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
const executor = new ToolExecutor(buildCatalog(), {
  store,
  getManifest: () => library.getManifest(),
  newId: () => crypto.randomUUID(),
});
const agentModel = "anthropic/claude-sonnet-4-6";
const agentSession = new AgentSession({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  gateway: agentGateway as any,
  executor,
  tools: buildCatalog(),
  model: agentModel,
});

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
      agent={{ session: agentSession, model: agentModel }}
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
