import { _electron as electron, test, expect } from "@playwright/test";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import path from "node:path";

// ── window-state round-trip ──────────────────────────────────────────────────

test("window-state: saved bounds are restored on relaunch", async () => {
  const tmpUserData = mkdtempSync(join(os.tmpdir(), "frontstage-winstate-"));
  mkdirSync(tmpUserData, { recursive: true });

  try {
    // Launch 1: resize window, close
    const app1 = await electron.launch({
      args: [
        path.join(__dirname, "../src/main/index.cjs"),
        `--user-data-dir=${tmpUserData}`,
      ],
      cwd: path.join(__dirname, ".."),
      env: { ...process.env, RENDERER_PORT: "5190", FRONTSTAGE_E2E: "1" },
    });

    try {
      const page1 = await app1.firstWindow();
      await page1.waitForLoadState("domcontentloaded", { timeout: 15_000 });

      // Set bounds via main-process eval
      await app1.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setBounds({ x: 100, y: 80, width: 1000, height: 700 });
      });

      // Small wait so the debounced save fires (300 ms debounce + buffer)
      await new Promise((r) => setTimeout(r, 800));
    } finally {
      await app1.close();
    }

    // window-state.json must exist with the saved bounds
    const statePath = join(tmpUserData, "window-state.json");
    expect(existsSync(statePath), "window-state.json must exist after close").toBe(true);

    const saved = JSON.parse(readFileSync(statePath, "utf8"));
    expect(saved.width).toBe(1000);
    expect(saved.height).toBe(700);
    // x/y may be adjusted by OS, just verify they are numbers
    expect(typeof saved.x).toBe("number");
    expect(typeof saved.y).toBe("number");

    // Launch 2: same userData — window must adopt the saved bounds
    const app2 = await electron.launch({
      args: [
        path.join(__dirname, "../src/main/index.cjs"),
        `--user-data-dir=${tmpUserData}`,
      ],
      cwd: path.join(__dirname, ".."),
      env: { ...process.env, RENDERER_PORT: "5190", FRONTSTAGE_E2E: "1" },
    });

    try {
      const page2 = await app2.firstWindow();
      await page2.waitForLoadState("domcontentloaded", { timeout: 15_000 });

      const bounds = await app2.evaluate(({ BrowserWindow }) => {
        return BrowserWindow.getAllWindows()[0]!.getBounds();
      });

      // Allow small OS-level deltas (decorations, DPI rounding)
      expect(Math.abs(bounds.width - 1000), "width within tolerance").toBeLessThanOrEqual(10);
      expect(Math.abs(bounds.height - 700), "height within tolerance").toBeLessThanOrEqual(10);
    } finally {
      await app2.close();
    }
  } finally {
    try { rmSync(tmpUserData, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// ── corrupt window-state doesn't brick ──────────────────────────────────────

test("window-state: corrupt file does not brick the app", async () => {
  const tmpUserData = mkdtempSync(join(os.tmpdir(), "frontstage-winstate-corrupt-"));
  mkdirSync(tmpUserData, { recursive: true });
  writeFileSync(join(tmpUserData, "window-state.json"), "this is not json {{{{", "utf8");

  const app = await electron.launch({
    args: [
      path.join(__dirname, "../src/main/index.cjs"),
      `--user-data-dir=${tmpUserData}`,
    ],
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, RENDERER_PORT: "5190", FRONTSTAGE_E2E: "1" },
  });

  try {
    const page = await app.firstWindow();
    // Must reach domcontentloaded (app is not bricked)
    await page.waitForLoadState("domcontentloaded", { timeout: 15_000 });

    // Default bounds: 1280×800
    const bounds = await app.evaluate(({ BrowserWindow }) => {
      return BrowserWindow.getAllWindows()[0]!.getBounds();
    });

    expect(bounds.width).toBe(1280);
    expect(bounds.height).toBe(800);
  } finally {
    await app.close();
    try { rmSync(tmpUserData, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// ── Open Recent native-menu path (IPC seam) ──────────────────────────────────

test("open-recent: native menu IPC path opens a recently saved project", async () => {
  const tmpUserData = mkdtempSync(join(os.tmpdir(), "frontstage-openrecent-"));
  const tmpProj = mkdtempSync(join(os.tmpdir(), "frontstage-proj-recent-"));

  const app = await electron.launch({
    args: [
      path.join(__dirname, "../src/main/index.cjs"),
      `--user-data-dir=${tmpUserData}`,
    ],
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, RENDERER_PORT: "5190", FRONTSTAGE_E2E: "1" },
  });

  try {
    const page = await app.firstWindow();
    page.on("pageerror", (err) => console.error("[pageerror]", err.message));
    page.on("console", (msg) => { if (msg.type() === "error") console.error("[renderer]", msg.text()); });

    // Wait for Editor + session
    await page.waitForSelector('[data-testid="top-bar-title"]', { timeout: 30_000 });
    await page.waitForFunction(
      () => (window as any).__projectSession && (window as any).__desktopGateway,
      { timeout: 15_000 },
    );

    // Seed: save a project so recent.json gets an entry
    const savedRef = await page.evaluate(async (dir: string) => {
      await (window as any).desktopProject.__setNextPick(dir);
      await (window as any).__projectSession.saveAs();
      // Wait briefly for the session to finish
      await new Promise((r) => setTimeout(r, 500));
      const state = (window as any).__projectSession.getState();
      return state?.ref ?? null;
    }, tmpProj);

    expect(savedRef, "saveAs must produce a ref").toBeTruthy();

    // Assert the native menu was rebuilt with the recent entry
    const menuHasRecent = await app.evaluate(({ Menu }) => {
      const menu = Menu.getApplicationMenu();
      if (!menu) return false;
      const fileMenu = menu.items.find((i: any) => i.label === "File");
      if (!fileMenu?.submenu) return false;
      const recentItem = fileMenu.submenu.items.find((i: any) => i.label === "Open Recent");
      if (!recentItem?.submenu) return false;
      // Should have at least one non-"No Recent Projects" item
      return recentItem.submenu.items.some((i: any) => i.enabled !== false && i.label !== "No Recent Projects");
    });

    expect(menuHasRecent, "Open Recent submenu must have a real entry").toBe(true);

    // Now drive the open-recent IPC path (simulating a native menu click)
    // First navigate away: new project so we can detect "open" happening
    await page.evaluate(async () => {
      await (window as any).__projectSession.newProject(() => Promise.resolve(true));
    });

    // Confirm we are at Untitled
    await page.waitForFunction(
      () => {
        const s = (window as any).__projectSession?.getState?.();
        return s === null || s?.name === "Untitled";
      },
      { timeout: 10_000 },
    );

    // Fire open-recent via the menu:command IPC seam
    await app.evaluate(({ BrowserWindow }, ref) => {
      const win = BrowserWindow.getAllWindows()[0];
      win?.webContents.send("menu:command", "open-recent", ref);
    }, savedRef);

    // The project should open — session state name changes from Untitled
    await page.waitForFunction(
      () => {
        const s = (window as any).__projectSession?.getState?.();
        return s !== null && s?.name !== "Untitled";
      },
      { timeout: 15_000 },
    );

    const finalState = await page.evaluate(() => (window as any).__projectSession.getState());
    expect(finalState?.ref?.id ?? finalState?.ref?.path).toBeTruthy();
  } finally {
    await app.close();
    try { rmSync(tmpUserData, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(tmpProj, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});
