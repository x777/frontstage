import { expect, test } from "@playwright/test";

// Sample project geometry (mirrors sample-project.ts + geometry.ts constants):
//   startFrame=0, durationFrames=90, zoom=1 (pixelsPerFrame=1), scrollX=0, headerWidth=0
//   RULER_HEIGHT=24, DEFAULT_TRACK_HEIGHT=50
//   clipRect → x=0, y=26, width=90, height=46
//   video track color: #0091C2 = rgb(0, 145, 194)

const CLIP_X = 45;  // middle of 90px-wide clip
const CLIP_Y = 49;  // middle of clip rect (y=26, h=46 → center ≈ 49)
const RULER_Y = 12; // inside ruler band (y < 24)

const VIDEO_R = 0;
const VIDEO_G = 145;
const VIDEO_B = 194;
const TOLERANCE = 30;

test("timeline-canvas exists and clip pixel matches video track color", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => localStorage.removeItem("palmier.editor.ui"));
  await page.reload();

  const canvas = page.locator('[data-testid="timeline-canvas"]');
  await expect(canvas).toBeVisible({ timeout: 10_000 });

  // Wait for canvas to be painted (non-zero size)
  await expect.poll(
    () => page.evaluate(() => {
      const cv = document.querySelector('[data-testid="timeline-canvas"]') as HTMLCanvasElement | null;
      return cv ? cv.width : 0;
    }),
    { timeout: 5_000 },
  ).toBeGreaterThan(0);

  // Small settle — one rAF cycle
  await page.waitForTimeout(100);

  const result = await page.evaluate(
    ({ clipX, clipY, rulerY }) => {
      const cv = document.querySelector('[data-testid="timeline-canvas"]') as HTMLCanvasElement | null;
      if (!cv) return null;
      const ctx = cv.getContext("2d");
      if (!ctx) return null;

      // Canvas physical size vs CSS size (DPR scaling)
      const cssW = cv.getBoundingClientRect().width;
      const cssH = cv.getBoundingClientRect().height;
      const dpr = cssW > 0 ? cv.width / cssW : 1;

      const px = Math.round(clipX * dpr);
      const py = Math.round(clipY * dpr);
      const rulerPy = Math.round(rulerY * dpr);

      const clipPixel = ctx.getImageData(px, py, 1, 1).data;
      const rulerPixel = ctx.getImageData(px, rulerPy, 1, 1).data;

      return {
        clip: [clipPixel[0], clipPixel[1], clipPixel[2], clipPixel[3]],
        ruler: [rulerPixel[0], rulerPixel[1], rulerPixel[2], rulerPixel[3]],
        canvasW: cv.width,
        canvasH: cv.height,
        dpr,
      };
    },
    { clipX: CLIP_X, clipY: CLIP_Y, rulerY: RULER_Y }
  );

  expect(result).not.toBeNull();

  const [cr, cg, cb] = result!.clip as number[];
  // Clip pixel should approximate #0091C2 (allow TOLERANCE for anti-aliasing/blending)
  expect(Math.abs(cr! - VIDEO_R)).toBeLessThan(TOLERANCE);
  expect(Math.abs(cg! - VIDEO_G)).toBeLessThan(TOLERANCE);
  expect(Math.abs(cb! - VIDEO_B)).toBeLessThan(TOLERANCE);

  // Ruler pixel should differ from the clip color (ruler is a dark bg, not the video blue)
  const [rr, rg, rb] = result!.ruler as number[];
  const clipRulerDiff = Math.abs(cg! - rg!) + Math.abs(cb! - rb!) + Math.abs(cr! - rr!);
  expect(clipRulerDiff).toBeGreaterThan(20);
});

test("timeline-canvas is non-empty after load", async ({ page }) => {
  await page.goto("/");

  const canvas = page.locator('[data-testid="timeline-canvas"]');
  await expect(canvas).toBeVisible({ timeout: 10_000 });

  await expect.poll(
    () => page.evaluate(() => {
      const cv = document.querySelector('[data-testid="timeline-canvas"]') as HTMLCanvasElement | null;
      return cv ? cv.width * cv.height : 0;
    }),
    { timeout: 5_000 },
  ).toBeGreaterThan(0);

  // Verify some pixels are non-zero (canvas has been drawn)
  const hasContent = await page.evaluate(() => {
    const cv = document.querySelector('[data-testid="timeline-canvas"]') as HTMLCanvasElement | null;
    if (!cv) return false;
    const ctx = cv.getContext("2d");
    if (!ctx) return false;
    const data = ctx.getImageData(0, 0, cv.width, Math.min(cv.height, 100)).data;
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i]! + data[i + 1]! + data[i + 2]!) > 0) return true;
    }
    return false;
  });
  expect(hasContent).toBe(true);
});

// Task 4 tests: select, scrub, zoom, scroll

type StoreProxy = {
  select(ids: string[]): void;
  getSnapshot(): {
    selection: ReadonlySet<string>;
    playhead: number;
    view: { zoom: number; scrollX: number };
    timeline: { tracks: Array<{ clips: Array<{ id: string }> }> };
  };
};

function getStore(win: Window): StoreProxy {
  return (win as unknown as { __palmierStore: StoreProxy }).__palmierStore;
}

async function waitForCanvas(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.removeItem("palmier.editor.ui"));
  await page.reload();
  const canvas = page.locator('[data-testid="timeline-canvas"]');
  await expect(canvas).toBeVisible({ timeout: 10_000 });
  await expect.poll(
    () => page.evaluate(() => {
      const cv = document.querySelector('[data-testid="timeline-canvas"]') as HTMLCanvasElement | null;
      return cv ? cv.width : 0;
    }),
    { timeout: 5_000 },
  ).toBeGreaterThan(0);
  await page.waitForTimeout(150);
}

test("click clip selects it; click empty deselects", async ({ page }) => {
  await waitForCanvas(page);

  const canvas = page.locator('[data-testid="timeline-canvas"]');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();

  // Click the clip body (CSS coords relative to viewport)
  await page.mouse.click(box!.x + CLIP_X, box!.y + CLIP_Y);
  await page.waitForTimeout(50);

  const clipId = await page.evaluate(() => {
    const store = getStore(window);
    return store.getSnapshot().timeline.tracks[0]!.clips[0]!.id;
    function getStore(win: Window): StoreProxy {
      return (win as unknown as { __palmierStore: StoreProxy }).__palmierStore;
    }
    type StoreProxy = {
      getSnapshot(): {
        selection: ReadonlySet<string>;
        playhead: number;
        view: { zoom: number; scrollX: number };
        timeline: { tracks: Array<{ clips: Array<{ id: string }> }> };
      };
    };
  });

  const selectionHasClip = await page.evaluate((id: string) => {
    const store = (window as unknown as { __palmierStore: { getSnapshot(): { selection: Set<string> } } }).__palmierStore;
    return store.getSnapshot().selection.has(id);
  }, clipId);
  expect(selectionHasClip).toBe(true);

  // Click empty area (below track area, or far right of the clip)
  // canvas width >> 90px, so click at x=200 which is past the clip
  await page.mouse.click(box!.x + 200, box!.y + CLIP_Y);
  await page.waitForTimeout(50);

  const selectionEmpty = await page.evaluate(() => {
    const store = (window as unknown as { __palmierStore: { getSnapshot(): { selection: Set<string> } } }).__palmierStore;
    return store.getSnapshot().selection.size === 0;
  });
  expect(selectionEmpty).toBe(true);
});

test("ruler drag scrubs playhead", async ({ page }) => {
  await waitForCanvas(page);

  const canvas = page.locator('[data-testid="timeline-canvas"]');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();

  const startX = box!.x + 5;
  const endX = box!.x + 60;
  const rulerAbsY = box!.y + RULER_Y;

  await page.mouse.move(startX, rulerAbsY);
  await page.mouse.down();
  // Move in several steps to simulate scrub
  for (let dx = 10; dx <= 60; dx += 10) {
    await page.mouse.move(box!.x + dx, rulerAbsY);
  }
  await page.mouse.move(endX, rulerAbsY);
  await page.mouse.up();
  await page.waitForTimeout(100);

  const playhead = await page.evaluate(() => {
    const store = (window as unknown as { __palmierStore: { getSnapshot(): { playhead: number } } }).__palmierStore;
    return store.getSnapshot().playhead;
  });
  // Released at x=60 within the canvas; with zoom=1 and scrollX=0, frame ≈ 60
  expect(playhead).toBeGreaterThan(0);
  expect(playhead).toBeLessThanOrEqual(90);
  // No thrown errors — test would fail if any unhandled rejection propagated
});

test("ctrl+wheel changes zoom; plain wheel changes scrollX", async ({ page }) => {
  await waitForCanvas(page);

  const canvas = page.locator('[data-testid="timeline-canvas"]');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();

  const cx = box!.x + CLIP_X;
  const cy = box!.y + CLIP_Y;

  const zoomBefore = await page.evaluate(() => {
    const store = (window as unknown as { __palmierStore: { getSnapshot(): { view: { zoom: number } } } }).__palmierStore;
    return store.getSnapshot().view.zoom;
  });

  // ctrl+wheel heavily to zoom in so content (90 frames) exceeds canvas width (~600px)
  // zoom in by exp(20*0.001) ≈ 1.022 per tick × many ticks via large deltaY
  await page.mouse.move(cx, cy);
  await page.keyboard.down("Control");
  await page.mouse.wheel(0, -20000); // large negative deltaY → zoom in a lot (exp(+20) clamped to MAX_ZOOM=40)
  await page.keyboard.up("Control");
  await page.waitForTimeout(150);

  const zoomAfter = await page.evaluate(() => {
    const store = (window as unknown as { __palmierStore: { getSnapshot(): { view: { zoom: number } } } }).__palmierStore;
    return store.getSnapshot().view.zoom;
  });
  expect(zoomAfter).toBeGreaterThan(zoomBefore);

  // plain wheel to scroll right — content is now 90 * MAX_ZOOM = 3600px >> canvas width
  const scrollBefore = await page.evaluate(() => {
    const store = (window as unknown as { __palmierStore: { getSnapshot(): { view: { scrollX: number } } } }).__palmierStore;
    return store.getSnapshot().view.scrollX;
  });

  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, 100); // positive deltaY → scroll right
  await page.waitForTimeout(100);

  const scrollAfter = await page.evaluate(() => {
    const store = (window as unknown as { __palmierStore: { getSnapshot(): { view: { scrollX: number } } } }).__palmierStore;
    return store.getSnapshot().view.scrollX;
  });
  expect(scrollAfter).toBeGreaterThan(scrollBefore);
});
