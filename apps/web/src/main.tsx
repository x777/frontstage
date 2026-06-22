import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { EditorStore, defaultTimeline } from "@palmier/core";
import "@palmier/ui/theme/tokens.css";
import { restoreLayout } from "@palmier/ui";
import { App } from "./App.js";

const store = new EditorStore(defaultTimeline());
restoreLayout(store);

const root = document.getElementById("root");
if (!root) throw new Error("No #root element");
createRoot(root).render(
  <StrictMode>
    <App store={store} />
  </StrictMode>,
);
