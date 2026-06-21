import { defineConfig } from "@playwright/test";
import path from "node:path";

export default defineConfig({
  workers: 1,
  fullyParallel: false,
  testDir: "./e2e",
  timeout: 120_000,
  // Start Vite renderer dev server before Electron launches
  webServer: {
    command: "pnpm dev:renderer",
    port: 5190,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  use: {
    launchOptions: {},
  },
  projects: [
    {
      name: "electron",
      testMatch: "**/*.spec.ts",
    },
  ],
});
