import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { EditorStore } from "@palmier/core";
import "@palmier/ui/theme/tokens.css";
import { restoreLayout } from "@palmier/ui";
import { App } from "./App.js";
import { sampleTimeline, webMediaSource } from "./sample-project.js";

const store = new EditorStore(sampleTimeline());
restoreLayout(store);

// Expose store for E2E tests
(window as unknown as Record<string, unknown>).__palmierStore = store;

const root = document.getElementById("root");
if (!root) throw new Error("No #root element");
createRoot(root).render(
  <StrictMode>
    <App store={store} media={webMediaSource} />
  </StrictMode>,
);
