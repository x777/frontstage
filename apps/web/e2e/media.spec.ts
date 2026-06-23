import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { expect, test, type Page } from "@playwright/test";

async function waitForEngineReady(page: Page) {
  await expect(page.locator('[data-testid="preview-canvas"]')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-testid="transport-playpause"]')).toBeVisible({ timeout: 15_000 });
  await page.waitForSelector('[data-testid="preview-canvas"][data-engine-ready="1"]', { timeout: 10_000 });
}

test("preview still renders non-black frame via library byte source (regression)", async ({ page }) => {
  await page.goto("/");

  const canvas = page.locator('[data-testid="preview-canvas"]');
  await expect(canvas).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-testid="transport-playpause"]')).toBeVisible({ timeout: 15_000 });
  await page.waitForSelector('[data-testid="preview-canvas"][data-engine-ready="1"]', { timeout: 10_000 });
  await page.waitForTimeout(800);

  const pixel = await page.evaluate(async () => {
    const canvas = document.querySelector('[data-testid="preview-canvas"]') as (HTMLCanvasElement & { __readPixel?: (x: number, y: number) => Promise<[number, number, number, number]> }) | null;
    if (!canvas?.__readPixel) return null;
    return canvas.__readPixel(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2));
  });

  expect(pixel).not.toBeNull();
  const [r, g, b] = pixel as [number, number, number, number];
  expect(r > 10 || g > 10 || b > 10).toBe(true);
});

test("media panel: grid shows seeded clip.mp4", async ({ page }) => {
  await page.goto("/");
  await waitForEngineReady(page);

  const items = page.locator('[data-testid="media-item"]');
  await expect(items).toHaveCount(1, { timeout: 5_000 });
  await expect(items.first()).toContainText("clip.mp4");
});

test("media panel: search field is present and disabled", async ({ page }) => {
  await page.goto("/");
  await waitForEngineReady(page);

  const search = page.locator('[data-testid="media-search"]');
  await expect(search).toBeVisible({ timeout: 5_000 });
  await expect(search).toBeDisabled();
});

test("media panel: import via file input adds new item", async ({ page }) => {
  await page.goto("/");
  await waitForEngineReady(page);

  // Minimal valid 1x1 red PNG (generated via canvas in-page to guarantee validity)
  const pngBuffer = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "red";
    ctx.fillRect(0, 0, 1, 1);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/png"),
    );
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });

  const fileInput = page.locator('input[type="file"][accept]');
  await fileInput.setInputFiles({
    name: "panel-import-test.png",
    mimeType: "image/png",
    buffer: Buffer.from(pngBuffer),
  });

  const newItem = page.locator('[data-testid="media-item"]', { hasText: "panel-import-test.png" });
  await expect(newItem).toBeVisible({ timeout: 8_000 });
});

test("importFiles adds an image entry with thumbnail", async ({ page }) => {
  await page.goto("/");
  await waitForEngineReady(page);

  const initialCount = await page.evaluate(() => {
    type Lib = { getSnapshot(): { entries: unknown[] } };
    const lib = (window as unknown as { __mediaLibrary: Lib }).__mediaLibrary;
    return lib.getSnapshot().entries.length;
  });

  const result = await page.evaluate(async () => {
    // Generate a tiny 2x2 PNG as a File via canvas
    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 2;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "red";
    ctx.fillRect(0, 0, 2, 2);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png");
    });
    const file = new File([blob], "test-image.png", { type: "image/png" });

    type Lib = {
      importFiles(files: File[]): Promise<Array<{ id: string; type: string }>>;
      getSnapshot(): { entries: unknown[] };
      thumbnail(id: string): string | undefined;
    };
    const lib = (window as unknown as { __mediaLibrary: Lib }).__mediaLibrary;
    const added = await lib.importFiles([file]);
    const snapshot = lib.getSnapshot();
    const entry = added[0];
    const thumb = entry ? lib.thumbnail(entry.id) : undefined;

    return {
      addedCount: added.length,
      totalEntries: snapshot.entries.length,
      entryType: entry?.type,
      entryId: entry?.id,
      hasThumbnail: typeof thumb === "string" && thumb.startsWith("data:"),
    };
  });

  expect(result.addedCount).toBe(1);
  expect(result.totalEntries).toBe(initialCount + 1);
  expect(result.entryType).toBe("image");
  expect(result.hasThumbnail).toBe(true);
});

test("drag media item onto existing track creates a clip with one undo", async ({ page }) => {
  await page.goto("/");
  await waitForEngineReady(page);

  // Wait for the seeded media item
  const item = page.locator('[data-testid="media-item"]').first();
  await expect(item).toBeVisible({ timeout: 8_000 });

  const itemBox = await item.boundingBox();
  expect(itemBox).not.toBeNull();

  const canvas = page.locator('[data-testid="timeline-canvas"]');
  await expect(canvas).toBeVisible({ timeout: 5_000 });
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();

  // Record clip ids before drag
  const beforeIds = await page.evaluate(() => {
    type Clip = { id: string };
    type Store = { getSnapshot(): { timeline: { tracks: Array<{ clips: Clip[] }> } } };
    const store = (window as unknown as { __palmierStore: Store }).__palmierStore;
    return store.getSnapshot().timeline.tracks.flatMap(t => t.clips.map(c => c.id));
  });
  const beforeCount = beforeIds.length;

  // Simulate the drag: pointerdown on media item, move over timeline, pointerup
  const startX = itemBox!.x + itemBox!.width / 2;
  const startY = itemBox!.y + itemBox!.height / 2;
  // Drop on first track, ~10% into timeline width
  const dropX = canvasBox!.x + canvasBox!.width * 0.1;
  const dropY = canvasBox!.y + 40; // inside first track (ruler ~24px, first track follows)

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Move in steps to trigger pointermove events
  await page.mouse.move(startX + 10, startY + 5, { steps: 3 });
  await page.mouse.move(dropX, dropY, { steps: 10 });
  await page.mouse.up();

  // A clip should have been added
  const afterCount = await page.evaluate(() => {
    type Store = { getSnapshot(): { timeline: { tracks: Array<{ clips: unknown[] }> } } };
    const store = (window as unknown as { __palmierStore: Store }).__palmierStore;
    return store.getSnapshot().timeline.tracks.reduce((s, t) => s + t.clips.length, 0);
  });
  expect(afterCount).toBe(beforeCount + 1);

  // The newly-added clip must reference "clip.mp4" exactly
  const newClipMediaRef = await page.evaluate((knownIds: string[]) => {
    type Clip = { id: string; mediaRef: string };
    type Store = { getSnapshot(): { timeline: { tracks: Array<{ clips: Clip[] }> } } };
    const store = (window as unknown as { __palmierStore: Store }).__palmierStore;
    const allClips = store.getSnapshot().timeline.tracks.flatMap(t => t.clips);
    const newClip = allClips.find(c => !knownIds.includes(c.id));
    return newClip?.mediaRef ?? null;
  }, beforeIds);
  expect(newClipMediaRef).toBe("clip.mp4");

  // canUndo should be true
  const canUndo = await page.evaluate(() => {
    type Store = { canUndo(): boolean };
    const store = (window as unknown as { __palmierStore: Store }).__palmierStore;
    return store.canUndo();
  });
  expect(canUndo).toBe(true);

  // ONE undo removes the clip
  await page.evaluate(() => {
    type Store = { undo(): void };
    const store = (window as unknown as { __palmierStore: Store }).__palmierStore;
    store.undo();
  });

  const afterUndoCount = await page.evaluate(() => {
    type Store = { getSnapshot(): { timeline: { tracks: Array<{ clips: unknown[] }> } } };
    const store = (window as unknown as { __palmierStore: Store }).__palmierStore;
    return store.getSnapshot().timeline.tracks.reduce((s, t) => s + t.clips.length, 0);
  });
  expect(afterUndoCount).toBe(beforeCount);

  // Preview canvas still renders (no crash)
  await expect(page.locator('[data-testid="preview-canvas"]')).toBeVisible();
});

test("drag to top boundary of track 0 lands on track 0, not a new track", async ({ page }) => {
  await page.goto("/");
  await waitForEngineReady(page);

  const item = page.locator('[data-testid="media-item"]').first();
  await expect(item).toBeVisible({ timeout: 8_000 });

  const itemBox = await item.boundingBox();
  expect(itemBox).not.toBeNull();

  const canvas = page.locator('[data-testid="timeline-canvas"]');
  await expect(canvas).toBeVisible({ timeout: 5_000 });
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();

  // Record track count before
  const beforeTracks = await page.evaluate(() => {
    type Store = { getSnapshot(): { timeline: { tracks: unknown[] } } };
    const store = (window as unknown as { __palmierStore: Store }).__palmierStore;
    return store.getSnapshot().timeline.tracks.length;
  });
  const beforeClips = await page.evaluate(() => {
    type Store = { getSnapshot(): { timeline: { tracks: Array<{ clips: unknown[] }> } } };
    const store = (window as unknown as { __palmierStore: Store }).__palmierStore;
    return store.getSnapshot().timeline.tracks.reduce((s, t) => s + t.clips.length, 0);
  });

  const startX = itemBox!.x + itemBox!.width / 2;
  const startY = itemBox!.y + itemBox!.height / 2;
  // Drop just a few px below the ruler (RULER_HEIGHT=24), inside track 0's visual area.
  // With dropZoneHeight=0 this resolves to track 0, not a new track.
  const dropX = canvasBox!.x + canvasBox!.width * 0.1;
  const dropY = canvasBox!.y + 27; // ruler=24px, so y=27 is well inside track 0

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 10, startY + 5, { steps: 3 });
  await page.mouse.move(dropX, dropY, { steps: 10 });
  await page.mouse.up();

  // Track count must NOT have increased (clip lands on existing track 0)
  const afterTracks = await page.evaluate(() => {
    type Store = { getSnapshot(): { timeline: { tracks: unknown[] } } };
    const store = (window as unknown as { __palmierStore: Store }).__palmierStore;
    return store.getSnapshot().timeline.tracks.length;
  });
  expect(afterTracks).toBe(beforeTracks);

  // Clip count must have increased by 1
  const afterClips = await page.evaluate(() => {
    type Store = { getSnapshot(): { timeline: { tracks: Array<{ clips: unknown[] }> } } };
    const store = (window as unknown as { __palmierStore: Store }).__palmierStore;
    return store.getSnapshot().timeline.tracks.reduce((s, t) => s + t.clips.length, 0);
  });
  expect(afterClips).toBe(beforeClips + 1);

  // Preview still live
  await expect(page.locator('[data-testid="preview-canvas"]')).toBeVisible();
});

test("drag media item below last track creates a new track", async ({ page }) => {
  await page.goto("/");
  await waitForEngineReady(page);

  const item = page.locator('[data-testid="media-item"]').first();
  await expect(item).toBeVisible({ timeout: 8_000 });

  const itemBox = await item.boundingBox();
  expect(itemBox).not.toBeNull();

  const canvas = page.locator('[data-testid="timeline-canvas"]');
  await expect(canvas).toBeVisible({ timeout: 5_000 });
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();

  // Record track count before
  const beforeTracks = await page.evaluate(() => {
    type Store = { getSnapshot(): { timeline: { tracks: unknown[] } } };
    const store = (window as unknown as { __palmierStore: Store }).__palmierStore;
    return store.getSnapshot().timeline.tracks.length;
  });

  const startX = itemBox!.x + itemBox!.width / 2;
  const startY = itemBox!.y + itemBox!.height / 2;
  // Drop well below the bottom of the timeline tracks (near the bottom of canvas)
  const dropX = canvasBox!.x + canvasBox!.width * 0.15;
  const dropY = canvasBox!.y + canvasBox!.height - 8; // near bottom edge → below all tracks

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 10, startY + 5, { steps: 3 });
  await page.mouse.move(dropX, dropY, { steps: 10 });
  await page.mouse.up();

  // A new track should have been created
  const afterTracks = await page.evaluate(() => {
    type Store = { getSnapshot(): { timeline: { tracks: unknown[] } } };
    const store = (window as unknown as { __palmierStore: Store }).__palmierStore;
    return store.getSnapshot().timeline.tracks.length;
  });
  expect(afterTracks).toBe(beforeTracks + 1);

  // canUndo true; one undo removes the new track
  const canUndo = await page.evaluate(() => {
    type Store = { canUndo(): boolean };
    const store = (window as unknown as { __palmierStore: Store }).__palmierStore;
    return store.canUndo();
  });
  expect(canUndo).toBe(true);

  await page.evaluate(() => {
    type Store = { undo(): void };
    const store = (window as unknown as { __palmierStore: Store }).__palmierStore;
    store.undo();
  });

  const afterUndoTracks = await page.evaluate(() => {
    type Store = { getSnapshot(): { timeline: { tracks: unknown[] } } };
    const store = (window as unknown as { __palmierStore: Store }).__palmierStore;
    return store.getSnapshot().timeline.tracks.length;
  });
  expect(afterUndoTracks).toBe(beforeTracks);

  // Preview still live
  await expect(page.locator('[data-testid="preview-canvas"]')).toBeVisible();
});
