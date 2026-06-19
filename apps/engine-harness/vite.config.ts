import { createReadStream, statSync } from "node:fs";
import path, { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

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

// Serve engine test fixtures at /test/fixtures/*
const serveEngineFixtures = (): Plugin => {
  const fixturesDir = resolve(__dirname, "../../packages/engine/test/fixtures");
  return {
    name: "serve-engine-fixtures",
    configureServer(server) {
      server.middlewares.use("/test/fixtures/", (req, res, next) => {
        const rel = ((req.url ?? "").replace(/^\//, "").split("?")[0]) ?? "";
        const file = path.resolve(fixturesDir, rel);
        if (!file.startsWith(fixturesDir + path.sep) || !file.endsWith(".mp4")) { next(); return; }
        try {
          const stat = statSync(file);
          res.setHeader("Content-Type", "video/mp4");
          res.setHeader("Content-Length", stat.size);
          createReadStream(file).pipe(res);
        } catch {
          next();
        }
      });
    },
  };
};

export default defineConfig({
  plugins: [crossOriginIsolation(), serveEngineFixtures()],
  server: { port: 5180 },
  preview: { port: 5180 },
});
