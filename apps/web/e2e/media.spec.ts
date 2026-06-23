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
