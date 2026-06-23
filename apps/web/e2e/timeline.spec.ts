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
