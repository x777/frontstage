import { expect, test } from "@playwright/test";

test("preview canvas renders a non-black frame", async ({ page }) => {
  await page.goto("/");

  // Wait for the preview canvas to appear
  const canvas = page.locator('[data-testid="preview-canvas"]');
  await expect(canvas).toBeVisible({ timeout: 15_000 });

  // Wait for the transport bar to appear (signals engine is ready)
  await expect(page.locator('[data-testid="transport-playpause"]')).toBeVisible({ timeout: 15_000 });

  // Wait for engine-ready marker on canvas
  await page.waitForSelector('[data-testid="preview-canvas"][data-engine-ready="1"]', { timeout: 10_000 });

  // Give engine time to render the first frame
  await page.waitForTimeout(800);

  // Use the engine's readPixel (reads from GPU buffer, works on WebGPU canvas)
  const pixel = await page.evaluate(async () => {
    const canvas = document.querySelector('[data-testid="preview-canvas"]') as (HTMLCanvasElement & { __readPixel?: (x: number, y: number) => Promise<[number, number, number, number]> }) | null;
    if (!canvas?.__readPixel) return null;
    return canvas.__readPixel(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2));
  });

  // pixel is [r, g, b, a] — at least one channel must be non-trivially above zero
  expect(pixel).not.toBeNull();
  const [r, g, b] = pixel as [number, number, number, number];
  const isNonBlack = r > 10 || g > 10 || b > 10;
  expect(isNonBlack).toBe(true);
});

test("play advances playhead, step-fwd advances by one frame", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.removeItem("palmier.editor.ui"));
  await page.reload();

  // Wait for engine ready
  await expect(page.locator('[data-testid="transport-playpause"]')).toBeVisible({ timeout: 15_000 });
  await page.waitForSelector('[data-testid="preview-canvas"][data-engine-ready="1"]', { timeout: 10_000 });

  // Read initial time
  const initialTime = await page.locator('[data-testid="transport-time"]').textContent();

  // Click play
  await page.locator('[data-testid="transport-playpause"]').click();

  // Wait ~600ms for playback to advance
  await page.waitForTimeout(600);

  // Click pause
  await page.locator('[data-testid="transport-playpause"]').click();

  // Time should have advanced
  const afterPlayTime = await page.locator('[data-testid="transport-time"]').textContent();
  expect(afterPlayTime).not.toBe(initialTime);

  // Snapshot before step
  const beforeStep = await page.locator('[data-testid="transport-time"]').textContent();

  // Step forward one frame
  await page.locator('[data-testid="transport-step-fwd"]').click();
  await page.waitForTimeout(300);

  const afterStep = await page.locator('[data-testid="transport-time"]').textContent();
  expect(afterStep).not.toBe(beforeStep);
});
