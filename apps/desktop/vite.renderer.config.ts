import { defineConfig } from "vite";

export default defineConfig({
  root: "src/renderer",
  server: { port: 5190 },
  preview: { port: 5190 },
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true,
  },
  // Allow imports from workspace packages
  resolve: {
    conditions: ["import", "module", "browser", "default"],
  },
});
