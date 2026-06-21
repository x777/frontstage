import { defineConfig } from "@playwright/test";
import path from "node:path";

export default defineConfig({
  workers: 1,
  fullyParallel: false,
  testDir: "./e2e",
  timeout: 60_000,
  // Start Vite renderer dev server before Electron launches
  webServer: {
    command: "pnpm dev:renderer",
    port: 5190,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  use: {
    // Electron env flag so main knows which port to connect to
    launchOptions: {},
  },
  projects: [
    {
      name: "electron-spike",
      testMatch: "**/*.spec.ts",
    },
  ],
});
