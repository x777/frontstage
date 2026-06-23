import { _electron as electron, test, expect } from "@playwright/test";
import { existsSync } from "node:fs";
import path from "node:path";

test("Electron renderer runs WebGPU compositor and ffmpeg encodes a frame", async () => {
  const app = await electron.launch({
    args: [path.join(__dirname, "../src/main/index.cjs")],
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      RENDERER_PORT: "5190",
    },
  });

  const page = await app.firstWindow();

  // Navigate to the spike page (default window now loads editor.html)
  await page.goto("http://localhost:5190/index.html");

  // Wait for spike to complete (ok or error)
  await page.waitForFunction(
    () => typeof (window as any).__spikeStatus === "string" && (window as any).__spikeStatus !== "",
    { timeout: 30_000 },
  );

  const status = await page.evaluate(() => (window as any).__spikeStatus as string);
  expect(status, `Spike status: ${status}`).toBe("ok");

  const out = await page.evaluate(() => (window as any).__spikeResult as string);
  expect(out).toBeTruthy();
  expect(existsSync(out), `ffmpeg output file should exist at: ${out}`).toBe(true);

  await app.close();
});
