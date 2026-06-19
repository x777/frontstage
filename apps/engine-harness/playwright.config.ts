import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  webServer: { command: "pnpm dev", port: 5180, reuseExistingServer: !process.env.CI },
  use: { baseURL: "http://localhost:5180" },
  projects: [
    {
      name: "chromium-webgpu",
      use: {
        browserName: "chromium",
        launchOptions: {
          // On Windows: must run headed (headless: false). The headless shell binary does not
          // expose a WebGPU adapter even with --enable-unsafe-webgpu. Headed Chrome uses D3D11
          // (default ANGLE backend) which works. Vulkan flags break adapter init on this machine.
          headless: false,
          args: [
            "--enable-unsafe-webgpu",
            "--ignore-gpu-blocklist",
          ],
        },
      },
    },
  ],
});
