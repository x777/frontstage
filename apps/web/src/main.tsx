import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { EditorStore } from "@palmier/core";
import "@palmier/ui/theme/tokens.css";
import { restoreLayout } from "@palmier/ui";
import { App } from "./App.js";
import { sampleTimeline, buildSampleLibrary } from "./sample-project.js";
import type { MediaLibrary } from "./media-library.js";

async function bootstrap() {
  const store = new EditorStore(sampleTimeline());
  restoreLayout(store);

  const library = await buildSampleLibrary();

  // Expose for E2E tests
  (window as unknown as Record<string, unknown>).__palmierStore = store;
  (window as unknown as Record<string, unknown>).__mediaLibrary = library;

  const root = document.getElementById("root");
  if (!root) throw new Error("No #root element");
  createRoot(root).render(
    <StrictMode>
      <App store={store} media={library.byteSource} library={library} />
    </StrictMode>,
  );
}

bootstrap().catch((err) => {
  console.error("Bootstrap failed:", err);
});
