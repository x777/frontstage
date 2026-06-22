import { defineConfig } from "@playwright/test";

export default defineConfig({
  workers: 1,
  fullyParallel: false,
  testDir: "./e2e",
  timeout: 30_000,
  webServer: { command: "pnpm dev", port: 5181, reuseExistingServer: !process.env.CI },
  use: { baseURL: "http://localhost:5181" },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        launchOptions: {
          headless: false,
        },
      },
    },
  ],
});
