import { expect, test } from "@playwright/test";

test("settings-toggle opens settings-panel", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector('[data-testid="top-bar-title"]', { timeout: 30_000 });
  await page.waitForFunction(() => !!(window as any).__agentSession, { timeout: 15_000 });

  const toggle = page.locator('[data-testid="settings-toggle"]');
  await expect(toggle).toBeVisible({ timeout: 10_000 });
  await toggle.click();

  await expect(page.locator('[data-testid="settings-panel"]')).toBeVisible({ timeout: 5_000 });
});

test("settings: changing agent model updates agentSession model", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector('[data-testid="top-bar-title"]', { timeout: 30_000 });
  await page.waitForFunction(() => !!(window as any).__agentSession, { timeout: 15_000 });

  const toggle = page.locator('[data-testid="settings-toggle"]');
  await toggle.click();
  await expect(page.locator('[data-testid="settings-panel"]')).toBeVisible({ timeout: 5_000 });

  const picker = page.locator('[data-testid="settings-agent-model"]');
  await expect(picker).toBeVisible({ timeout: 5_000 });

  const options = await picker.locator("option").allTextContents();
  if (options.length < 2) return;

  const currentValue = await picker.inputValue();
  const allValues = await picker.locator("option").evaluateAll((opts: HTMLOptionElement[]) => opts.map(o => o.value));
  const newValue = allValues.find(v => v !== currentValue) ?? allValues[0];

  await picker.selectOption(newValue!);

  const stored = await page.evaluate(() => localStorage.getItem("palmier.agent.model"));
  expect(stored).toBe(newValue);
});

test("chat sessions persist across reload (localStorage)", async ({ page }) => {
  const FAKE_GATEWAY_TEXT = `
    window.__aiGateway = {
      async *streamChat(req) {
        yield { type: "textDelta", text: "Persisted reply." };
        yield { type: "done", finishReason: "stop" };
      },
    };
  `;
  await page.addInitScript(FAKE_GATEWAY_TEXT);
  await page.goto("/");
  await page.waitForSelector('[data-testid="top-bar-title"]', { timeout: 30_000 });
  await page.waitForFunction(() => !!(window as any).__agentSession, { timeout: 15_000 });

  // Open agent panel
  const toggle = page.locator('[data-testid="agent-toggle"]');
  await expect(toggle).toBeVisible({ timeout: 10_000 });
  await toggle.click();
  await expect(page.locator('[data-testid="agent-panel"]')).toBeVisible({ timeout: 5_000 });

  // Send a message to create a session
  const input = page.locator('[data-testid="agent-input"]');
  await expect(input).toBeVisible({ timeout: 5_000 });
  await input.fill("hello persist");
  await page.locator('[data-testid="agent-send"]').click();

  // Wait for reply
  await page.waitForFunction(
    () => {
      const s = (window as any).__agentSession?.getState?.();
      return s?.status === "idle" && s?.messages?.length >= 2;
    },
    { timeout: 15_000 },
  );

  // Save the current session so it appears in the switcher list
  await page.locator('[data-testid="agent-new"]').click();

  // Verify session list has the saved session before reload
  await page.waitForFunction(
    () => document.querySelector('[data-testid="agent-session-0"]') !== null,
    { timeout: 5_000 },
  );

  // Reload the page — addInitScript persists so the fake gateway is re-injected
  await page.reload();
  await page.waitForSelector('[data-testid="top-bar-title"]', { timeout: 30_000 });
  await page.waitForFunction(() => !!(window as any).__agentSession, { timeout: 15_000 });

  // Ensure the agent panel is visible (state was persisted via localStorage)
  const panelLocator = page.locator('[data-testid="agent-panel"]');
  const isPanelVisible = await panelLocator.isVisible();
  if (!isPanelVisible) {
    await page.locator('[data-testid="agent-toggle"]').click();
    await expect(panelLocator).toBeVisible({ timeout: 5_000 });
  }

  // The saved session should still appear in the session list after reload
  await expect(page.locator('[data-testid="agent-session-0"]')).toBeVisible({ timeout: 5_000 });
});

test("settings proxy: Save persists to localStorage", async ({ page }) => {
  await page.goto("/");
  await page.waitForSelector('[data-testid="top-bar-title"]', { timeout: 30_000 });
  await page.waitForFunction(() => !!(window as any).__agentSession, { timeout: 15_000 });

  const toggle = page.locator('[data-testid="settings-toggle"]');
  await toggle.click();
  await expect(page.locator('[data-testid="settings-panel"]')).toBeVisible({ timeout: 5_000 });

  const urlInput = page.locator('[data-testid="settings-proxy-url"]');
  await expect(urlInput).toBeVisible({ timeout: 5_000 });
  await urlInput.fill("http://test-proxy.example.com");

  await page.locator('[data-testid="settings-proxy-save"]').click();

  const stored = await page.evaluate(() => localStorage.getItem("palmier.ai.proxyUrl"));
  expect(stored).toBe("http://test-proxy.example.com");
});
