import { _electron as electron, test, expect } from "@playwright/test";
import path from "node:path";

// Fake gateway: turn 1 → textDelta + toolCallComplete(generate_image) + done(tool_calls)
//               turn 2 → textDelta("Added.") + done(stop)
// Also provides generateImage for the ImageGenerator seam.
const FAKE_GATEWAY_SCRIPT = `
  try { localStorage.removeItem("frontstage.agent.visible"); } catch {}
  window.__aiGateway = {
    _turn: 0,
    async *streamChat(req) {
      this._turn++;
      if (this._turn === 1) {
        yield { type: "textDelta", text: "Generating." };
        yield { type: "toolCallComplete", id: "g1", name: "generate_image", args: { prompt: "a sunset" } };
        yield { type: "done", finishReason: "tool_calls" };
      } else {
        yield { type: "textDelta", text: "Added." };
        yield { type: "done", finishReason: "stop" };
      }
    },
    async generateImage(req) {
      return {
        images: [{
          base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
          mediaType: "image/png",
        }],
      };
    },
  };
`;

test("agent: generate_image tool adds an image entry to the media library", async () => {
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

    await page.goto("http://localhost:5190/editor.html");
    await page.addInitScript(FAKE_GATEWAY_SCRIPT);
    await page.reload();

    await page.waitForSelector('[data-testid="top-bar-title"]', { timeout: 30_000 });
    await page.waitForFunction(
      () => !!(window as any).__frontstageStore && !!(window as any).__agentSession,
      { timeout: 15_000 },
    );

    // Record initial entry count
    const beforeCount = await page.evaluate(() => {
      return (window as any).__mediaLibrary?.getManifest()?.entries?.length ?? 0;
    });

    // Open the agent panel
    const toggle = page.locator('[data-testid="agent-toggle"]');
    await expect(toggle).toBeVisible({ timeout: 10_000 });
    await toggle.click();
    await expect(page.locator('[data-testid="agent-panel"]')).toBeVisible({ timeout: 5_000 });

    // Send the message
    const input = page.locator('[data-testid="agent-input"]');
    await expect(input).toBeVisible({ timeout: 5_000 });
    await input.fill("generate a sunset");

    const sendBtn = page.locator('[data-testid="agent-send"]');
    await expect(sendBtn).toBeEnabled({ timeout: 3_000 });
    await sendBtn.click();

    // Wait for agent to finish (status idle, 3+ messages)
    await page.waitForFunction(
      () => {
        const session = (window as any).__agentSession;
        if (!session) return false;
        const state = session.getState?.();
        return state?.status === "idle" && state?.messages?.length >= 3;
      },
      { timeout: 20_000 },
    );

    // (a) tool call chip for generate_image rendered
    const toolCallChip = page.locator('[data-testid="agent-toolcall"]').first();
    await expect(toolCallChip).toContainText("generate_image", { timeout: 5_000 });

    // (a) assistant replied with "Added."
    const assistantMsgs = page.locator('[data-testid="agent-msg-assistant"]');
    await expect(assistantMsgs.last()).toContainText("Added.", { timeout: 5_000 });

    // (b) media library gained a new image entry with the correct prompt
    const newEntry = await page.evaluate((before) => {
      const entries: any[] = (window as any).__mediaLibrary?.getManifest()?.entries ?? [];
      return entries.slice(before).find((e: any) => e.type === "image") ?? null;
    }, beforeCount);

    expect(newEntry).not.toBeNull();
    expect(newEntry.type).toBe("image");
    expect(newEntry.generationInput?.prompt).toBe("a sunset");
  } finally {
    await app.close();
  }
});
