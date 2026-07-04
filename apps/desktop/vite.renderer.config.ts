import { createReadStream, statSync } from "node:fs";
import path, { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

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

// The audio engine uses SharedArrayBuffer (AudioWorklet ring buffer), which needs the page to be
// cross-origin isolated — otherwise audio silently fails to start.
const crossOriginIsolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig(({ command }) => ({
  root: "src/renderer",
  // Packaged main loads editor.html via file://, which needs relative asset URLs — absolute "/"
  // paths only resolve correctly against the vite dev server, so this only applies to `build`.
  base: command === "build" ? "./" : "/",
  server: { port: 5190, headers: crossOriginIsolation },
  preview: { port: 5190, headers: crossOriginIsolation },
  plugins: [serveEngineFixtures()],
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, "src/renderer/index.html"),
        editor: resolve(__dirname, "src/renderer/editor.html"),
        export: resolve(__dirname, "src/renderer/export.html"),
        "gateway-test": resolve(__dirname, "src/renderer/gateway-test.html"),
        "ai-gateway-test": resolve(__dirname, "src/renderer/ai-gateway-test.html"),
        "image-gen-test": resolve(__dirname, "src/renderer/image-gen-test.html"),
      },
    },
  },
  resolve: {
    conditions: ["import", "module", "browser", "default"],
  },
}));
