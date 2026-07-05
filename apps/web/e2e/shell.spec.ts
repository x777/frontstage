import { expect, test } from "@playwright/test";

test("layout shell renders four panels; maximize fills one; persists", async ({ page }) => {
  // Clear localStorage before test
  await page.goto("/");
  await page.evaluate(() => localStorage.removeItem("frontstage.editor.ui"));
  await page.reload();

  for (const id of ["panel-media", "panel-preview", "panel-timeline", "panel-inspector"]) {
    await expect(page.locator(`[data-testid="${id}"]`)).toBeVisible();
  }

  await page.locator('[data-testid="maximize-preview"]').click();
  await expect(page.locator('[data-testid="panel-timeline"]')).toBeHidden();

  await page.reload();
  await expect(page.locator('[data-testid="panel-timeline"]')).toBeHidden(); // persisted
});
