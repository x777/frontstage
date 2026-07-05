import { expect, test, type Page } from "@playwright/test";

async function waitForEngineReady(page: Page) {
  await expect(page.locator('[data-testid="preview-canvas"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-testid="transport-playpause"]')).toBeVisible({ timeout: 15_000 });
  await page.waitForSelector('[data-testid="preview-canvas"][data-engine-ready="1"]', { timeout: 10_000 });
}

test("transform overlay appears on selection and single undo reverts whole drag", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.removeItem("frontstage.editor.ui"));
  await page.reload();
  await waitForEngineReady(page);

  // Select the sample clip via the store
  await page.evaluate(() => {
    type StoreProxy = {
      select(ids: string[]): void;
      getSnapshot(): { timeline: { tracks: Array<{ clips: Array<{ id: string }> }> } };
    };
    const store = (window as unknown as { __frontstageStore: StoreProxy }).__frontstageStore;
    const snap = store.getSnapshot();
    const clipId = snap.timeline.tracks[0]!.clips[0]!.id;
    store.select([clipId]);
  });

  // Wait for the transform overlay to appear
  await expect(page.locator('[data-testid="transform-handle-move"]')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('[data-testid="transform-handle-tl"]')).toBeVisible();
  await expect(page.locator('[data-testid="transform-handle-br"]')).toBeVisible();

  // Record original transform
  const originalCX = await page.evaluate(() => {
    type StoreProxy = {
      getSnapshot(): { timeline: { tracks: Array<{ clips: Array<{ transform: { centerX: number } }> }> } };
    };
    const store = (window as unknown as { __frontstageStore: StoreProxy }).__frontstageStore;
    return store.getSnapshot().timeline.tracks[0]!.clips[0]!.transform.centerX;
  });

  // Drag the move handle by a known delta
  const moveHandle = page.locator('[data-testid="transform-handle-move"]');
  const handleBox = await moveHandle.boundingBox();
  expect(handleBox).not.toBeNull();

  const startX = handleBox!.x + handleBox!.width / 2;
  const startY = handleBox!.y + handleBox!.height / 2;
  const dragDelta = 40; // px in page space

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + dragDelta, startY + dragDelta, { steps: 5 });
  await page.mouse.up();

  // Clip's centerX should have changed
  const newCX = await page.evaluate(() => {
    type StoreProxy = {
      getSnapshot(): { timeline: { tracks: Array<{ clips: Array<{ transform: { centerX: number } }> }> } };
    };
    const store = (window as unknown as { __frontstageStore: StoreProxy }).__frontstageStore;
    return store.getSnapshot().timeline.tracks[0]!.clips[0]!.transform.centerX;
  });
  expect(newCX).not.toBe(originalCX);

  // canUndo must be true
  const canUndo = await page.evaluate(() => {
    type StoreProxy = { canUndo(): boolean };
    const store = (window as unknown as { __frontstageStore: StoreProxy }).__frontstageStore;
    return store.canUndo();
  });
  expect(canUndo).toBe(true);

  // ONE undo should revert the entire drag back to the original value
  await page.evaluate(() => {
    type StoreProxy = { undo(): void };
    const store = (window as unknown as { __frontstageStore: StoreProxy }).__frontstageStore;
    store.undo();
  });

  const afterUndoCX = await page.evaluate(() => {
    type StoreProxy = {
      getSnapshot(): { timeline: { tracks: Array<{ clips: Array<{ transform: { centerX: number } }> }> } };
    };
    const store = (window as unknown as { __frontstageStore: StoreProxy }).__frontstageStore;
    return store.getSnapshot().timeline.tracks[0]!.clips[0]!.transform.centerX;
  });
  expect(afterUndoCX).toBe(originalCX);

  // After one undo, canUndo should be false (only one undo entry for the whole drag)
  const canUndoAfter = await page.evaluate(() => {
    type StoreProxy = { canUndo(): boolean };
    const store = (window as unknown as { __frontstageStore: StoreProxy }).__frontstageStore;
    return store.canUndo();
  });
  expect(canUndoAfter).toBe(false);
});

test("crop overlay appears on selection and drag updates crop", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.removeItem("frontstage.editor.ui"));
  await page.reload();
  await waitForEngineReady(page);

  // Select the sample clip
  await page.evaluate(() => {
    type StoreProxy = {
      select(ids: string[]): void;
      getSnapshot(): { timeline: { tracks: Array<{ clips: Array<{ id: string }> }> } };
    };
    const store = (window as unknown as { __frontstageStore: StoreProxy }).__frontstageStore;
    const snap = store.getSnapshot();
    const clipId = snap.timeline.tracks[0]!.clips[0]!.id;
    store.select([clipId]);
  });

  // Crop handles should be visible
  await expect(page.locator('[data-testid="crop-handle-left"]')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('[data-testid="crop-handle-right"]')).toBeVisible();
  await expect(page.locator('[data-testid="crop-handle-top"]')).toBeVisible();
  await expect(page.locator('[data-testid="crop-handle-bottom"]')).toBeVisible();

  // Record original crop
  const originalLeft = await page.evaluate(() => {
    type StoreProxy = {
      getSnapshot(): { timeline: { tracks: Array<{ clips: Array<{ crop: { left: number } }> }> } };
    };
    const store = (window as unknown as { __frontstageStore: StoreProxy }).__frontstageStore;
    return store.getSnapshot().timeline.tracks[0]!.clips[0]!.crop.left;
  });

  // Drag the left crop handle rightward to increase left crop
  const leftHandle = page.locator('[data-testid="crop-handle-left"]');
  const handleBox = await leftHandle.boundingBox();
  expect(handleBox).not.toBeNull();

  const startX = handleBox!.x + handleBox!.width / 2;
  const startY = handleBox!.y + handleBox!.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 20, startY, { steps: 4 });
  await page.mouse.up();

  // Crop left should have increased
  const newLeft = await page.evaluate(() => {
    type StoreProxy = {
      getSnapshot(): { timeline: { tracks: Array<{ clips: Array<{ crop: { left: number } }> }> } };
    };
    const store = (window as unknown as { __frontstageStore: StoreProxy }).__frontstageStore;
    return store.getSnapshot().timeline.tracks[0]!.clips[0]!.crop.left;
  });
  expect(newLeft).not.toBe(originalLeft);
  expect(newLeft).toBeGreaterThan(originalLeft);
});

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
  await page.evaluate(() => localStorage.removeItem("frontstage.editor.ui"));
  await page.reload();

  // Wait for engine ready
  await expect(page.locator('[data-testid="transport-playpause"]')).toBeVisible({ timeout: 15_000 });
  await page.waitForSelector('[data-testid="preview-canvas"][data-engine-ready="1"]', { timeout: 10_000 });

  // Read initial time
  const initialTime = await page.locator('[data-testid="transport-time"]').textContent();

  // Click play
  await page.locator('[data-testid="transport-playpause"]').click();

  // Poll until playhead advances past start
  await expect.poll(
    () => page.locator('[data-testid="transport-time"]').textContent(),
    { timeout: 5_000 },
  ).not.toBe(initialTime);

  // Click pause
  await page.locator('[data-testid="transport-playpause"]').click();

  // Time should have advanced
  const afterPlayTime = await page.locator('[data-testid="transport-time"]').textContent();
  expect(afterPlayTime).not.toBe(initialTime);

  // Snapshot before step
  const beforeStep = await page.locator('[data-testid="transport-time"]').textContent();

  // Step forward one frame — poll for the update
  await page.locator('[data-testid="transport-step-fwd"]').click();
  await expect.poll(
    () => page.locator('[data-testid="transport-time"]').textContent(),
    { timeout: 3_000 },
  ).not.toBe(beforeStep);

  const afterStep = await page.locator('[data-testid="transport-time"]').textContent();
  expect(afterStep).not.toBe(beforeStep);
});
