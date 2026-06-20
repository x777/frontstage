import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __layerCount: (frame: number) => Promise<number>;
    __coordinatorReady: boolean;
  }
}

test("layersForScrub returns 2 layers when both clips are visible, 1 when only bottom remains", async ({ page }) => {
  await page.goto("/coordinator.html");
  await page.waitForFunction(() => window.__coordinatorReady === true, { timeout: 30_000 });

  // frame 0 — both clips active → expect 2 layers
  const twoLayers = await page.evaluate(() => window.__layerCount(0));
  expect(twoLayers).toBe(2);

  // Read halfDuration from the status text so we target a frame beyond it
  const statusText = await page.locator("#status").textContent();
  const halfMatch = statusText?.match(/half=(\d+)/);
  const halfDuration = halfMatch ? parseInt(halfMatch[1]!, 10) : 1;

  // frame past halfDuration — only bottom clip active → expect 1 layer
  const oneLayers = await page.evaluate((f) => window.__layerCount(f), halfDuration);
  expect(oneLayers).toBe(1);
});
