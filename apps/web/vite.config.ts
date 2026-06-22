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

export default defineConfig({
  plugins: [react(), crossOriginIsolation()],
  server: { port: 5181 },
  preview: { port: 5181 },
});
