import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const crossOriginIsolation = (): Plugin => ({
  name: "cross-origin-isolation",
  configureServer(server) {
    server.middlewares.use((_req, res, next) => {
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
      next();
    });
  },
  configurePreviewServer(server) {
    server.middlewares.use((_req, res, next) => {
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
      next();
    });
  },
});

// The relay-hosted deployment (T3) serves this build under /studio/, but the local dev server and
// e2e suite must keep hitting "/" — otherwise playwright.config.ts's baseURL breaks. `mode` is
// "production" only for `vite build`, never for `vite`/`vite dev`, so this only affects production output.
export default defineConfig(({ mode }) => ({
  base: mode === "production" ? "/studio/" : "/",
  plugins: [react(), crossOriginIsolation()],
  server: { port: 5181 },
  preview: { port: 5181 },
}));
