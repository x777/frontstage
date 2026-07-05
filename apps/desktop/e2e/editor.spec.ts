import { _electron as electron, test, expect } from "@playwright/test";
import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import path from "node:path";

test("Editor: panels render, on-disk round-trip, and menu IPC routing", async () => {
  const tempA = mkdtempSync(join(os.tmpdir(), "frontstage-editor-test-"));

  const app = await electron.launch({
    args: [path.join(__dirname, "../src/main/index.cjs")],
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      RENDERER_PORT: "5190",
      FRONTSTAGE_E2E: "1",
    },
  });

  try {
    const page = await app.firstWindow();

    page.on("console", (msg) => console.log("[renderer]", msg.type(), msg.text()));
    page.on("pageerror", (err) => console.error("[renderer pageerror]", err.message));

    // Wait for the Editor to mount — the top-bar title is always rendered
    await page.waitForSelector('[data-testid="top-bar-title"]', { timeout: 30_000 });

    // ── 1. Assert the 5 panels render ─────────────────────────────────────
    await expect(page.locator('[data-testid="panel-media"]')).toBeVisible();
    await expect(page.locator('[data-testid="panel-preview"]')).toBeVisible();
    await expect(page.locator('[data-testid="panel-timeline"]')).toBeVisible();
    await expect(page.locator('[data-testid="panel-inspector"]')).toBeVisible();
    // Top bar is the 5th UI region
    await expect(page.locator('[data-testid="top-bar-title"]')).toBeVisible();

    // ── 2. Wait for session + gateway to be exposed ────────────────────────
    await page.waitForFunction(
      () =>
        (window as any).__projectSession &&
        (window as any).__frontstageStore &&
        (window as any).__desktopGateway,
      { timeout: 15_000 },
    );

    // ── 3. On-disk round-trip: Save As ─────────────────────────────────────
    // Set next pick to tempA so the DesktopGateway dialog seam returns it
    await page.evaluate(async (dir: string) => {
      await (window as any).desktopProject.__setNextPick(dir);
    }, tempA);

    // Trigger Save As via the in-app file menu (uses the same guarded handler)
    await page.click('[data-testid="file-menu"]');
    await page.click('[data-testid="file-save-as"]');

    // Wait for project.json to appear on disk (poll via JS side-effect)
    await page.waitForFunction(
      async () => {
        // The session state name changes after a successful save-as
        const session = (window as any).__projectSession;
        return session && session.getState && session.getState() !== null && session.getState().name !== "Untitled";
      },
      { timeout: 15_000 },
    );

    // Node-side: assert project.json exists on disk
    expect(existsSync(join(tempA, "project.json")), "project.json must exist after Save As").toBe(true);

    // ── 4. Make a timeline edit then New (with discard) ────────────────────
    // Modify fps to mark dirty
    await page.evaluate(() => {
      const store = (window as any).__frontstageStore;
      const snap = store.getSnapshot();
      store.load({ ...snap.timeline, fps: 24 });
    });

    // Trigger New via native menu command (IPC path)
    await page.evaluate(async () => {
      // Simulate a menu:command "new" through the preload bridge
      // The onMenuCommand callback is registered once onReady fires.
      // We can drive it by calling desktopProject's internal handler if exposed,
      // or by dispatching an ipcRenderer event — but from renderer we can only
      // use the public API. Instead, use the in-app FileMenu.
      // The discard dialog will appear since fps was changed.
    });

    await page.click('[data-testid="file-menu"]');
    await page.click('[data-testid="file-new"]');

    // Discard dialog should appear because the store is dirty
    await page.waitForSelector('[data-testid="discard-dialog"]', { timeout: 5_000 });
    await page.click('[data-testid="discard-dont-save"]');

    // After discard + new, the session should have no saved path (Untitled)
    await page.waitForFunction(
      () => {
        const session = (window as any).__projectSession;
        const state = session?.getState?.();
        return state === null || (state && state.name === "Untitled");
      },
      { timeout: 10_000 },
    );

    // ── 5. Open the saved project ──────────────────────────────────────────
    await page.evaluate(async (dir: string) => {
      await (window as any).desktopProject.__setNextPick(dir);
    }, tempA);

    await page.click('[data-testid="file-menu"]');
    await page.click('[data-testid="file-open"]');

    // Wait for timeline to be loaded from disk (fps should be 30, the default)
    await page.waitForFunction(
      () => {
        const store = (window as any).__frontstageStore;
        const snap = store?.getSnapshot?.();
        return snap?.timeline?.fps === 30;
      },
      { timeout: 15_000 },
    );

    const restoredFps = await page.evaluate(() => {
      return (window as any).__frontstageStore.getSnapshot().timeline.fps;
    });
    expect(restoredFps).toBe(30);

    // Verify the saved project.json on disk has the correct content
    // The file stores timeline fields at the top level (schemaVersion + spread timeline).
    const projectJson = JSON.parse(readFileSync(join(tempA, "project.json"), "utf-8"));
    expect(projectJson.schemaVersion).toBeDefined();
    expect(projectJson.fps).toBe(30);

    // ── 6. Native-menu dirty-guard: IPC path must open discard dialog ─────
    // Make the store dirty via a real dispatch
    await page.evaluate(() => {
      const store = (window as any).__frontstageStore;
      const snap = store.getSnapshot();
      store.load({ ...snap.timeline, fps: 29 });
    });

    // Drive the native-menu path by firing the registered onMenuCommand callback
    // through the e2e test hook exposed by the preload (FRONTSTAGE_E2E=1).
    // This exercises the exact same code path as Electron main sending menu:command.
    await page.evaluate(() => {
      (window as any).__e2eMenuTrigger.fire("new");
    });

    // The discard dialog must appear because the store is dirty
    await page.waitForSelector('[data-testid="discard-dialog"]', { timeout: 5_000 });

    // Cancel — timeline must be unchanged
    await page.click('[data-testid="discard-cancel"]');
    await expect(page.locator('[data-testid="discard-dialog"]')).not.toBeVisible();

    // fps is still 29 (edit was not lost)
    const fpsAfterCancel = await page.evaluate(() =>
      (window as any).__frontstageStore.getSnapshot().timeline.fps,
    );
    expect(fpsAfterCancel).toBe(29);
  } finally {
    await app.close();
    try { rmSync(tempA, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});
