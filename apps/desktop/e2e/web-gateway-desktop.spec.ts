import { _electron as electron, test, expect } from "@playwright/test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import path from "node:path";

test("DesktopGateway: pickSaveAs, writeProject, writeMedia, readProject, readMedia, recent, security", async () => {
  const tempDir = mkdtempSync(join(os.tmpdir(), "palmier-gw-test-"));
  const unauthorizedDir = mkdtempSync(join(os.tmpdir(), "palmier-unauth-"));

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

    // Navigate to the gateway test page
    await page.goto(`http://localhost:5190/gateway-test.html`);
    page.on("console", (msg) => console.log("[renderer]", msg.type(), msg.text()));
    page.on("pageerror", (err) => console.error("[renderer pageerror]", err.message));

    // Wait for gateway classes to be available
    await page.waitForFunction(
      () => typeof (window as any).__DesktopGateway === "function",
      { timeout: 15_000 },
    );

    // ── pickSaveAs via test stub ────────────────────────────────────────────
    const refPath = await page.evaluate(async (dir: string) => {
      await (window as any).desktopProject.__setNextPick(dir);
      const gw = new (window as any).__DesktopGateway();
      const ref = await gw.pickSaveAs("P");
      (window as any).__testRef = ref;
      return ref ? ref.path : null;
    }, tempDir);

    expect(refPath).toBe(tempDir);

    // ── writeProject + writeMedia (renderer side writes) ───────────────────
    await page.evaluate(async () => {
      const gw = new (window as any).__DesktopGateway();
      const ref = (window as any).__testRef;
      const bound = await gw.bind(ref);
      const doc = {
        timeline: {
          fps: 30, width: 1920, height: 1080, settingsConfigured: true, tracks: [],
        },
        manifest: { version: 1, assets: [] },
        generationLog: { version: 1, entries: [] },
      };
      await (window as any).__writeProject(bound.store, doc);
      await bound.media.writeMedia("media/a.bin", new Uint8Array([1, 2, 3]));
    });

    // ── On-disk assertions (Node side) ────────────────────────────────────
    expect(existsSync(join(tempDir, "project.json")), "project.json must exist on disk").toBe(true);
    expect(existsSync(join(tempDir, "media", "a.bin")), "media/a.bin must exist on disk").toBe(true);

    // ── readProject + readMedia (renderer side reads back) ─────────────────
    const readResult = await page.evaluate(async () => {
      const gw = new (window as any).__DesktopGateway();
      const ref = (window as any).__testRef;
      const bound = await gw.bind(ref);
      const doc = await (window as any).__readProject(bound.store);
      const bytes = await bound.media.readMedia("media/a.bin");
      return { fps: doc.timeline.fps, bytes: Array.from(bytes) };
    });

    expect(readResult.fps).toBe(30);
    expect(readResult.bytes).toEqual([1, 2, 3]);

    // ── addRecent + listRecent + removeRecent ──────────────────────────────
    await page.evaluate(async () => {
      const gw = new (window as any).__DesktopGateway();
      const ref = (window as any).__testRef;
      await gw.addRecent(ref);
    });

    const recentAfterAdd = await page.evaluate(async () => {
      const gw = new (window as any).__DesktopGateway();
      const list = await gw.listRecent();
      return list.map((r: any) => r.id);
    });
    expect(recentAfterAdd).toContain(tempDir);

    await page.evaluate(async () => {
      const gw = new (window as any).__DesktopGateway();
      const ref = (window as any).__testRef;
      await gw.removeRecent(ref);
    });

    const recentAfterRemove = await page.evaluate(async () => {
      const gw = new (window as any).__DesktopGateway();
      const list = await gw.listRecent();
      return list.map((r: any) => r.id);
    });
    expect(recentAfterRemove).not.toContain(tempDir);

    // ── SECURITY: path traversal writeMedia rejects ────────────────────────
    const traversalError = await page.evaluate(async () => {
      const gw = new (window as any).__DesktopGateway();
      const ref = (window as any).__testRef;
      const bound = await gw.bind(ref);
      try {
        await bound.media.writeMedia("../evil.bin", new Uint8Array([9]));
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    });
    expect(traversalError, "traversal must reject").toBeTruthy();
    expect(traversalError).toMatch(/escapes/i);

    // ── SECURITY: unauthorized dir readText rejects ────────────────────────
    const unauthorizedError = await page.evaluate(async (unauthDir: string) => {
      try {
        await (window as any).desktopProject.readText(unauthDir, "project.json");
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    }, unauthorizedDir);
    expect(unauthorizedError, "unauthorized dir must reject").toBeTruthy();
    expect(unauthorizedError).toMatch(/unauthorized/i);
  } finally {
    await app.close();
    try { rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(unauthorizedDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});
