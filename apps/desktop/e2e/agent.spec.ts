import { _electron as electron, test, expect } from "@playwright/test";
import path from "node:path";

// Fake gateway: turn 1 → textDelta + toolCallComplete(add_clips) + done(tool_calls)
//               turn 2 → textDelta("Done.") + done(stop)
// Also clears persisted agent panel visibility so toggle always opens it fresh.
const FAKE_GATEWAY_SCRIPT = `
  try { localStorage.removeItem("frontstage.agent.visible"); } catch {}
  window.__aiGateway = {
    _turn: 0,
    async *streamChat(req) {
      this._turn++;
      if (this._turn === 1) {
        const mediaId = window.__mediaLibrary?.getManifest()?.entries?.[0]?.id ?? "clip.mp4";
        yield { type: "textDelta", text: "Adding a clip." };
        yield {
          type: "toolCallComplete",
          id: "c1",
          name: "add_clips",
          args: { clips: [{ mediaId, startFrame: 30 }] },
        };
        yield { type: "done", finishReason: "tool_calls" };
      } else {
        yield { type: "textDelta", text: "Done." };
        yield { type: "done", finishReason: "stop" };
      }
    },
  };
`;

test("agent panel: chat message adds a clip to the timeline", async () => {
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

    // Navigate to the editor
    await page.goto("http://localhost:5190/editor.html");

    // Inject fake gateway before the page has bootstrapped
    await page.addInitScript(FAKE_GATEWAY_SCRIPT);

    // Reload so addInitScript takes effect before bootstrap
    await page.reload();

    // Wait for app to be ready
    await page.waitForSelector('[data-testid="top-bar-title"]', { timeout: 30_000 });
    await page.waitForFunction(
      () => !!(window as any).__frontstageStore && !!(window as any).__agentSession,
      { timeout: 15_000 },
    );

    // Click agent-toggle to reveal agent panel
    const toggle = page.locator('[data-testid="agent-toggle"]');
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    await toggle.click();

    // Agent panel should be visible
    await expect(page.locator('[data-testid="agent-panel"]')).toBeVisible({ timeout: 5_000 });

    // Record clip count before
    const beforeCount = await page.evaluate(() => {
      type Store = { getSnapshot(): { timeline: { tracks: Array<{ clips: unknown[] }> } } };
      const store = (window as unknown as { __frontstageStore: Store }).__frontstageStore;
      return store.getSnapshot().timeline.tracks.reduce((s, t) => s + t.clips.length, 0);
    });

    // Seed a media entry into the desktop's empty library so add_clips can resolve it
    // (the fake gateway reads window.__mediaLibrary lazily at streamChat call time)
    await page.evaluate(() => {
      const MEDIA_ID = "test-clip-desktop";
      type Lib = {
        loadManifest(manifest: { version: number; entries: unknown[]; folders: unknown[] }, gw: null): void;
        getManifest(): { version: number; entries: { id: string }[]; folders: unknown[] };
      };
      const lib = (window as unknown as { __mediaLibrary: Lib }).__mediaLibrary;
      if (lib.getManifest().entries.length > 0) return;
      lib.loadManifest({
        version: 2,
        entries: [{
          id: MEDIA_ID,
          name: "test-clip.mp4",
          type: "video",
          source: { kind: "project", relativePath: "media/test-clip.mp4" },
          duration: 3,
        }],
        folders: [],
      }, null);
    });

    // Type message and send
    const input = page.locator('[data-testid="agent-input"]');
    await expect(input).toBeVisible({ timeout: 5_000 });
    await input.fill("add a clip");

    const sendBtn = page.locator('[data-testid="agent-send"]');
    await expect(sendBtn).toBeEnabled({ timeout: 3_000 });
    await sendBtn.click();

    // Wait for agent to finish (status idle, "Done." present)
    await page.waitForFunction(
      () => {
        const session = (window as any).__agentSession;
        if (!session) return false;
        const state = session.getState?.();
        return state?.status === "idle" && state?.messages?.length >= 3;
      },
      { timeout: 20_000 },
    );

    // Assert assistant text rendered
    const assistantMsgs = page.locator('[data-testid="agent-msg-assistant"]');
    await expect(assistantMsgs.first()).toContainText("Adding a clip.", { timeout: 10_000 });

    // Assert tool call chip rendered (add_clips)
    const toolCallChip = page.locator('[data-testid="agent-toolcall"]').first();
    await expect(toolCallChip).toContainText("add_clips", { timeout: 5_000 });

    // Assert the clip was ACTUALLY added to the timeline
    const afterCount = await page.evaluate(() => {
      type Store = { getSnapshot(): { timeline: { tracks: Array<{ clips: unknown[] }> } } };
      const store = (window as unknown as { __frontstageStore: Store }).__frontstageStore;
      return store.getSnapshot().timeline.tracks.reduce((s, t) => s + t.clips.length, 0);
    });
    expect(afterCount).toBe(beforeCount + 1);

    // Verify the clip is at frame 30
    const clipAtFrame30 = await page.evaluate(() => {
      type Clip = { startFrame: number };
      type Store = { getSnapshot(): { timeline: { tracks: Array<{ clips: Clip[] }> } } };
      const store = (window as unknown as { __frontstageStore: Store }).__frontstageStore;
      const allClips = store.getSnapshot().timeline.tracks.flatMap((t) => t.clips);
      return allClips.some((c) => c.startFrame === 30);
    });
    expect(clipAtFrame30).toBe(true);

    // "Done." text also present in a later assistant message
    await expect(assistantMsgs.last()).toContainText("Done.", { timeout: 5_000 });
  } finally {
    await app.close();
  }
});
