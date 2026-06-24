import { _electron as electron, test, expect } from "@playwright/test";
import { existsSync, mkdtempSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import path from "node:path";

test("DesktopExportGateway: real FFmpeg export to picked path + unauthorized reject", async () => {
  const tempDir = mkdtempSync(join(os.tmpdir(), "palmier-export-e2e-"));
  const outFile = join(tempDir, "out.mp4");
  // Use a non-tmpdir path for unauthorized security check (tmpdir is allowed for test harnesses)
  const unauthorizedDir = join(os.homedir(), ".palmier-test-unauth-" + Date.now());
  const unauthorizedOut = join(unauthorizedDir, "evil.mp4");
  try { mkdirSync(unauthorizedDir, { recursive: true }); } catch { /* ignore */ }

  const app = await electron.launch({
    args: [path.join(__dirname, "../src/main/index.cjs")],
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      RENDERER_PORT: "5190",
      PALMIER_E2E: "1",
    },
  });

  try {
    const page = await app.firstWindow();

    page.on("console", (msg) => console.log("[renderer]", msg.type(), msg.text()));
    page.on("pageerror", (err) => console.error("[renderer pageerror]", err.message));

    // Wait for the Editor to mount
    await page.waitForSelector('[data-testid="top-bar-title"]', { timeout: 30_000 });

    // Wait for session + store + library to be exposed
    await page.waitForFunction(
      () =>
        (window as any).__projectSession &&
        (window as any).__palmierStore &&
        (window as any).__mediaLibrary,
      { timeout: 15_000 },
    );

    // Seed a 1×1 solid PNG into the media library and set a 3-frame timeline
    await page.evaluate(async () => {
      const W = 320, H = 240, FPS = 30, FRAMES = 3;

      // Create a minimal PNG via OffscreenCanvas
      const oc = new OffscreenCanvas(W, H);
      const ctx = oc.getContext("2d")!;
      ctx.fillStyle = "rgb(64,128,192)";
      ctx.fillRect(0, 0, W, H);
      const blob = await oc.convertToBlob({ type: "image/png" });
      const url = URL.createObjectURL(blob);

      const entry = {
        id: "e2e-frame",
        name: "frame.png",
        source: { kind: "project" as const, relativePath: "media/frame.png" },
        type: "image" as const,
        duration: 5,
        sourceWidth: W,
        sourceHeight: H,
      };

      // Seed the library
      const lib = (window as any).__mediaLibrary;
      await lib.seed("e2e-frame", url, entry);

      // Load a timeline with this image clip
      const store = (window as any).__palmierStore;
      store.load({
        fps: FPS,
        width: W,
        height: H,
        settingsConfigured: true,
        tracks: [{
          id: "track-img",
          type: "image",
          muted: false,
          hidden: false,
          syncLocked: false,
          clips: [{
            id: "clip-img",
            mediaRef: "e2e-frame",
            mediaType: "image",
            sourceClipType: "image",
            startFrame: 0,
            durationFrames: FRAMES,
            trimStartFrame: 0,
            trimEndFrame: 0,
            speed: 1,
            volume: 1,
            fadeInFrames: 0,
            fadeOutFrames: 0,
            fadeInInterpolation: "linear",
            fadeOutInterpolation: "linear",
            opacity: 1,
            transform: {
              centerX: 0.5, centerY: 0.5,
              width: 1, height: 1,
              rotation: 0,
              flipHorizontal: false, flipVertical: false,
            },
            crop: { left: 0, top: 0, right: 0, bottom: 0 },
          }],
        }],
      });

      URL.revokeObjectURL(url);
    });

    // Set the next export pick so the save dialog is bypassed
    await page.evaluate(async (p: string) => {
      await (window as any).desktopProject.__setNextExportPick(p);
    }, outFile);

    // Trigger export via the File menu
    await page.click('[data-testid="file-menu"]');
    await page.click('[data-testid="file-export"]');

    // Export progress overlay should appear
    await page.waitForSelector('[data-testid="export-progress"]', { timeout: 10_000 });

    // Wait for it to clear (export done) — real FFmpeg, allow generous time
    await page.waitForFunction(
      () => !document.querySelector('[data-testid="export-progress"]'),
      { timeout: 120_000 },
    );

    // Node-side: out.mp4 must exist and be non-empty
    expect(existsSync(outFile), `out.mp4 must exist at ${outFile}`).toBe(true);
    expect(statSync(outFile).size, "out.mp4 must be non-empty").toBeGreaterThan(0);

    // SECURITY: export:start with an unauthorized (non-tmpdir) outPath must reject
    const securityError = await page.evaluate(async (unauthorizedPath: string) => {
      try {
        await (window as any).desktopExport.start({
          width: 320,
          height: 240,
          fps: 30,
          codec: "libx264",
          outPath: unauthorizedPath,
        });
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    }, unauthorizedOut);

    expect(securityError, "export:start to unauthorized path must reject").toBeTruthy();
    expect(securityError).toMatch(/unauthorized|not authorized/i);
  } finally {
    await app.close();
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(unauthorizedDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});
