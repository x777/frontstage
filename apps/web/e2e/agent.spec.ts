import { expect, test } from "@playwright/test";

// Fake gateway: turn 1 → textDelta + toolCallComplete(add_clips) + done(tool_calls)
//               turn 2 → textDelta("Done.") + done(stop)
const FAKE_GATEWAY_SCRIPT = `
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
          args: { clips: [{ mediaId, trackIndex: 0, startFrame: 30 }] },
        };
        yield { type: "done", finishReason: "tool_calls" };
      } else {
        yield { type: "textDelta", text: "Done." };
        yield { type: "done", finishReason: "stop" };
      }
    },
  };
`;

const FAKE_GATEWAY_TEXT_ONLY = `
  window.__aiGateway = {
    _lastReq: null,
    async *streamChat(req) {
      this._lastReq = req;
      yield { type: "textDelta", text: "Got it." };
      yield { type: "done", finishReason: "stop" };
    },
  };
`;

test("agent panel: chat message adds a clip to the timeline", async ({ page }) => {
  // Inject fake gateway BEFORE bootstrap
  await page.addInitScript(FAKE_GATEWAY_SCRIPT);

  await page.goto("/");

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

  // Type message and send
  const input = page.locator('[data-testid="agent-input"]');
  await expect(input).toBeVisible({ timeout: 5_000 });
  await input.fill("add a clip");

  const sendBtn = page.locator('[data-testid="agent-send"]');
  await expect(sendBtn).toBeEnabled({ timeout: 3_000 });
  await sendBtn.click();

  // Wait for agent to finish (status idle again, "Done." text present)
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
});

test("agent panel: New Chat button resets the session", async ({ page }) => {
  await page.addInitScript(FAKE_GATEWAY_TEXT_ONLY);
  await page.goto("/");

  await page.waitForSelector('[data-testid="top-bar-title"]', { timeout: 30_000 });
  await page.waitForFunction(
    () => !!(window as any).__agentSession,
    { timeout: 15_000 },
  );

  // Open agent panel
  await page.locator('[data-testid="agent-toggle"]').click();
  await expect(page.locator('[data-testid="agent-panel"]')).toBeVisible({ timeout: 5_000 });

  // The New Chat button should be visible (session switcher is mounted)
  const newBtn = page.locator('[data-testid="agent-new"]');
  await expect(newBtn).toBeVisible({ timeout: 5_000 });

  // Type and send a message so we have something to clear
  const input = page.locator('[data-testid="agent-input"]');
  await input.fill("hello");
  await page.locator('[data-testid="agent-send"]').click();

  // Wait for the reply
  await page.waitForFunction(
    () => {
      const s = (window as any).__agentSession?.getState?.();
      return s?.status === "idle" && s?.messages?.length >= 2;
    },
    { timeout: 15_000 },
  );

  // Click New Chat
  await newBtn.click();

  // Session should now be empty
  const isEmpty = await page.evaluate(() => {
    const s = (window as any).__agentSession?.getState?.();
    return s?.messages?.length === 0;
  });
  expect(isEmpty).toBe(true);
});

test("agent panel: @-mention picker appears + text context sent", async ({ page }) => {
  await page.addInitScript(FAKE_GATEWAY_TEXT_ONLY);
  await page.goto("/");

  await page.waitForSelector('[data-testid="top-bar-title"]', { timeout: 30_000 });
  await page.waitForFunction(
    () => !!(window as any).__agentSession,
    { timeout: 15_000 },
  );

  // Open agent panel
  await page.locator('[data-testid="agent-toggle"]').click();
  await expect(page.locator('[data-testid="agent-panel"]')).toBeVisible({ timeout: 5_000 });

  const input = page.locator('[data-testid="agent-input"]');
  await expect(input).toBeVisible({ timeout: 5_000 });

  // Type @ to trigger mention picker
  await input.fill("@");

  // The mention option should appear (seeded library has clip.mp4)
  const option0 = page.locator('[data-testid="agent-mention-option-0"]');
  await expect(option0).toBeVisible({ timeout: 5_000 });

  // Select the mention
  await option0.click();

  // Input should now contain @clip.mp4
  const inputVal = await input.inputValue();
  expect(inputVal).toContain("@clip.mp4");

  // Send the message
  const sendBtn = page.locator('[data-testid="agent-send"]');
  await expect(sendBtn).toBeEnabled({ timeout: 3_000 });
  await sendBtn.click();

  // Wait for reply
  await page.waitForFunction(
    () => {
      const s = (window as any).__agentSession?.getState?.();
      return s?.status === "idle" && s?.messages?.length >= 2;
    },
    { timeout: 15_000 },
  );

  // The first user message should contain the @media context text
  const firstUserMsg = await page.evaluate(() => {
    const s = (window as any).__agentSession?.getState?.();
    const firstMsg = s?.messages?.[0];
    const block = firstMsg?.content?.[0];
    return block?.kind === "text" ? block.text : "";
  });

  expect(firstUserMsg).toContain("@media clip.mp4");
});
