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
