import { _electron as electron, test, expect } from "@playwright/test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import path from "node:path";

const CASES: Array<{ label: string; content: string }> = [
  { label: "not-json", content: "not json at all" },
  { label: "object-not-array", content: '{"not":"an array"}' },
  { label: "path-not-string", content: '[{"id":"x","name":"y","path":123}]' },
  { label: "missing-path", content: '[{"id":"x","name":"y"}]' },
];

for (const { label, content } of CASES) {
  test(`corrupt recent.json (${label}): launch succeeds + listRecent returns []`, async () => {
    const tmpUserData = mkdtempSync(join(os.tmpdir(), `frontstage-recent-harden-${label}-`));
    writeFileSync(join(tmpUserData, "recent.json"), content, "utf8");

    const app = await electron.launch({
      args: [
        path.join(__dirname, "../src/main/index.cjs"),
        `--user-data-dir=${tmpUserData}`,
      ],
      cwd: path.join(__dirname, ".."),
      env: {
        ...process.env,
        RENDERER_PORT: "5190",
        FRONTSTAGE_E2E: "1",
      },
    });

    try {
      const page = await app.firstWindow();
      page.on("pageerror", (err) => console.error(`[${label} pageerror]`, err.message));

      // App must reach the editor page without bricking
      await page.waitForLoadState("domcontentloaded", { timeout: 15_000 });

      const recent = await page.evaluate(async () => {
        return (window as any).desktopProject.listRecent();
      });

      expect(Array.isArray(recent), "listRecent must return an array").toBe(true);
      expect(recent, `malformed recent.json (${label}) must yield []`).toHaveLength(0);
    } finally {
      await app.close();
      try { rmSync(tmpUserData, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
}
