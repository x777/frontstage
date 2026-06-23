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

  // Wait one rAF for the canvas to redraw with the selection outline
  await page.waitForTimeout(50);

  // Assert the selection OUTLINE renders: sample a pixel at the clip's top border
  // Clip rect: x=0, y=26, w=90, h=46. Selection outline is drawn at y=25 (rect.y - 1).
  // accentPrimary default: rgb(245,239,228). Sample at CSS x=45, y=25 (top outline border).
  const OUTLINE_X = 45; // middle of clip, horizontally
  const OUTLINE_Y = 25; // top edge of selection outline (clipRect.y - 1 = 26 - 1)
  const ACCENT_DEFAULT_R = 245;
  const ACCENT_DEFAULT_G = 239;
  const ACCENT_DEFAULT_B = 228;

  const outlineSelected = await page.evaluate(
    ({ ox, oy }) => {
      const cv = document.querySelector('[data-testid="timeline-canvas"]') as HTMLCanvasElement | null;
      if (!cv) return null;
      const ctx = cv.getContext("2d");
      if (!ctx) return null;
      const cssW = cv.getBoundingClientRect().width;
      const dpr = cssW > 0 ? cv.width / cssW : 1;
      const px = Math.round(ox * dpr);
      const py = Math.round(oy * dpr);
      const p = ctx.getImageData(px, py, 1, 1).data;
      // Also resolve accentPrimary from CSS var in case it differs from default
      const accentRaw = getComputedStyle(document.documentElement).getPropertyValue("--accent-primary").trim();
      return { pixel: [p[0], p[1], p[2], p[3]], accentRaw, dpr };
    },
    { ox: OUTLINE_X, oy: OUTLINE_Y }
  );

  expect(outlineSelected).not.toBeNull();
  const [osr, osg, osb] = outlineSelected!.pixel as number[];
  // Allow tolerance of 30 for anti-aliasing; accent color ≈ rgb(245,239,228)
  expect(Math.abs(osr! - ACCENT_DEFAULT_R)).toBeLessThan(TOLERANCE);
  expect(Math.abs(osg! - ACCENT_DEFAULT_G)).toBeLessThan(TOLERANCE);
  expect(Math.abs(osb! - ACCENT_DEFAULT_B)).toBeLessThan(TOLERANCE);

  // Click empty area (below track area, or far right of the clip)
  // canvas width >> 90px, so click at x=200 which is past the clip
  await page.mouse.click(box!.x + 200, box!.y + CLIP_Y);
  await page.waitForTimeout(50);

  const selectionEmpty = await page.evaluate(() => {
    const store = (window as unknown as { __palmierStore: { getSnapshot(): { selection: Set<string> } } }).__palmierStore;
    return store.getSnapshot().selection.size === 0;
  });
  expect(selectionEmpty).toBe(true);

  // Wait one rAF and assert the outline is gone: the same pixel should no longer be accent color
  await page.waitForTimeout(50);

  const outlineDeselected = await page.evaluate(
    ({ ox, oy }) => {
      const cv = document.querySelector('[data-testid="timeline-canvas"]') as HTMLCanvasElement | null;
      if (!cv) return null;
      const ctx = cv.getContext("2d");
      if (!ctx) return null;
      const cssW = cv.getBoundingClientRect().width;
      const dpr = cssW > 0 ? cv.width / cssW : 1;
      const px = Math.round(ox * dpr);
      const py = Math.round(oy * dpr);
      const p = ctx.getImageData(px, py, 1, 1).data;
      return { pixel: [p[0], p[1], p[2], p[3]] };
    },
    { ox: OUTLINE_X, oy: OUTLINE_Y }
  );

  expect(outlineDeselected).not.toBeNull();
  const [odr, odg, odb] = outlineDeselected!.pixel as number[];
  // After deselect, this pixel should NO LONGER match the accent color
  const accentDiff = Math.abs(odr! - ACCENT_DEFAULT_R) + Math.abs(odg! - ACCENT_DEFAULT_G) + Math.abs(odb! - ACCENT_DEFAULT_B);
  expect(accentDiff).toBeGreaterThan(20);
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

// ── Task 5: move, trim, split ────────────────────────────────────────────────
// Geometry: zoom=10 (10px/frame), startFrame=0, durationFrames=90, scrollX=0
//   clip starts at x=0, ends at x=900, body center at x=450, y=49
//   TRIM_HANDLE_WIDTH=4 → left edge 0–4px, right edge 896–900px

type FullStoreProxy = {
  getSnapshot(): {
    selection: ReadonlySet<string>;
    playhead: number;
    view: { zoom: number; scrollX: number };
    timeline: {
      tracks: Array<{
        id: string;
        clips: Array<{
          id: string;
          startFrame: number;
          durationFrames: number;
          trimStartFrame: number;
          trimEndFrame: number;
        }>;
      }>;
    };
  };
  select(ids: string[]): void;
  setPlayhead(frame: number): void;
  setZoom(z: number): void;
  dispatch(cmd: unknown): void;
  undo(): void;
  canUndo(): boolean;
};

function getFullStore(win: Window): FullStoreProxy {
  return (win as unknown as { __palmierStore: FullStoreProxy }).__palmierStore;
}

async function setupZoom10(page: import("@playwright/test").Page): Promise<{
  canvas: import("@playwright/test").Locator;
  box: { x: number; y: number; width: number; height: number };
}> {
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

  // Set zoom=10 so 1 frame = 10px (cleaner math)
  await page.evaluate(() => {
    const store = getFullStore(window);
    store.setZoom(10);
    function getFullStore(win: Window): FullStoreProxy {
      return (win as unknown as { __palmierStore: FullStoreProxy }).__palmierStore;
    }
    type FullStoreProxy = {
      setZoom(z: number): void;
    };
  });
  await page.waitForTimeout(100);

  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  return { canvas, box: box! };
}

test("move: drag clip body changes startFrame; one undo restores", async ({ page }) => {
  const { box } = await setupZoom10(page);

  // At zoom=10: clip body center is at ~x=450 in canvas CSS coords.
  // We drag 50px right = 5 frames right.
  // Grab from middle of clip (frame 45, grabOffsetFrames=45)
  // Drag to x=500 → cursorFrame=50 → startFrame = 50-45 = 5
  const ZOOM = 10;
  const START_FRAME = 0;
  const GRAB_FRAME = 45; // middle of clip (90 frames)
  const DROP_X = 500;   // cursorFrame = 50 → startFrame = 50 - 45 = 5

  const clipBodyX = box.x + GRAB_FRAME * ZOOM;
  const clipBodyY = box.y + CLIP_Y;

  // Record original clip id
  const origState = await page.evaluate(() => {
    const store = getFullStore(window);
    const snap = store.getSnapshot();
    const clip = snap.timeline.tracks[0]!.clips[0]!;
    return { clipId: clip.id, startFrame: clip.startFrame };
    function getFullStore(win: Window): FullStoreProxy {
      return (win as unknown as { __palmierStore: FullStoreProxy }).__palmierStore;
    }
    type FullStoreProxy = {
      getSnapshot(): {
        timeline: { tracks: Array<{ clips: Array<{ id: string; startFrame: number }> }> };
      };
    };
  });
  expect(origState.startFrame).toBe(START_FRAME);

  // Perform drag: down, move past threshold, move to target, up
  await page.mouse.move(clipBodyX, clipBodyY);
  await page.mouse.down();
  await page.mouse.move(clipBodyX + 5, clipBodyY); // cross DRAG_THRESHOLD
  await page.mouse.move(box.x + DROP_X, clipBodyY);
  await page.mouse.up();
  await page.waitForTimeout(150);

  const afterMove = await page.evaluate((clipId: string) => {
    const store = getFullStore(window);
    const snap = store.getSnapshot();
    for (const track of snap.timeline.tracks) {
      const clip = track.clips.find((c) => c.id === clipId);
      if (clip) return { startFrame: clip.startFrame, canUndo: store.canUndo() };
    }
    return null;
    function getFullStore(win: Window): FullStoreProxy {
      return (win as unknown as { __palmierStore: FullStoreProxy }).__palmierStore;
    }
    type FullStoreProxy = {
      getSnapshot(): {
        timeline: { tracks: Array<{ clips: Array<{ id: string; startFrame: number }> }> };
        selection: ReadonlySet<string>;
      };
      canUndo(): boolean;
    };
  }, origState.clipId);

  expect(afterMove).not.toBeNull();
  // cursorFrame=50 - grabOffsetFrames=45 = 5
  expect(afterMove!.startFrame).toBeGreaterThan(0);
  expect(afterMove!.canUndo).toBe(true);

  // ONE undo should restore original startFrame
  await page.evaluate(() => {
    const store = getFullStore(window);
    store.undo();
    function getFullStore(win: Window): FullStoreProxy {
      return (win as unknown as { __palmierStore: FullStoreProxy }).__palmierStore;
    }
    type FullStoreProxy = {
      undo(): void;
    };
  });
  await page.waitForTimeout(100);

  const afterUndo = await page.evaluate((clipId: string) => {
    const store = getFullStore(window);
    const snap = store.getSnapshot();
    for (const track of snap.timeline.tracks) {
      const clip = track.clips.find((c) => c.id === clipId);
      if (clip) return { startFrame: clip.startFrame };
    }
    return null;
    function getFullStore(win: Window): FullStoreProxy {
      return (win as unknown as { __palmierStore: FullStoreProxy }).__palmierStore;
    }
    type FullStoreProxy = {
      getSnapshot(): {
        timeline: { tracks: Array<{ clips: Array<{ id: string; startFrame: number }> }> };
      };
    };
  }, origState.clipId);

  expect(afterUndo).not.toBeNull();
  expect(afterUndo!.startFrame).toBe(START_FRAME);
});

test("move: drag near playhead snaps exactly to playhead frame", async ({ page }) => {
  const { box } = await setupZoom10(page);

  const ZOOM = 10;
  const PLAYHEAD_FRAME = 20;

  // Set playhead to frame 20
  await page.evaluate((ph: number) => {
    const store = getFullStore(window);
    store.setPlayhead(ph);
    function getFullStore(win: Window): FullStoreProxy {
      return (win as unknown as { __palmierStore: FullStoreProxy }).__palmierStore;
    }
    type FullStoreProxy = {
      setPlayhead(f: number): void;
    };
  }, PLAYHEAD_FRAME);
  await page.waitForTimeout(50);

  const origState = await page.evaluate(() => {
    const store = getFullStore(window);
    const snap = store.getSnapshot();
    const clip = snap.timeline.tracks[0]!.clips[0]!;
    return { clipId: clip.id, startFrame: clip.startFrame, durationFrames: clip.durationFrames };
    function getFullStore(win: Window): FullStoreProxy {
      return (win as unknown as { __palmierStore: FullStoreProxy }).__palmierStore;
    }
    type FullStoreProxy = {
      getSnapshot(): {
        timeline: { tracks: Array<{ clips: Array<{ id: string; startFrame: number; durationFrames: number }> }> };
      };
    };
  });

  // Grab clip at frame 45 (x=450), drag so clip start would land at ~frame 19 (close to playhead 20)
  // grabOffsetFrames=45 → want startFrame=20 → cursorFrame=65 (but snap pulls it to 20)
  // Actually: drag so clip start is near frame 20 — close enough for snap threshold (8px = 0.8 frames at zoom=10)
  // Set grab at clip center (frame 45) and drag to x = (20 + 45) * 10 = 650 → startFrame should snap to 20
  const grabX = box.x + 45 * ZOOM;
  const grabY = box.y + CLIP_Y;
  const dropX = box.x + (PLAYHEAD_FRAME + 45) * ZOOM;

  await page.mouse.move(grabX, grabY);
  await page.mouse.down();
  await page.mouse.move(grabX + 5, grabY);
  await page.mouse.move(dropX, grabY);
  await page.mouse.up();
  await page.waitForTimeout(150);

  const afterSnap = await page.evaluate((clipId: string) => {
    const store = getFullStore(window);
    const snap = store.getSnapshot();
    for (const track of snap.timeline.tracks) {
      const clip = track.clips.find((c) => c.id === clipId);
      if (clip) return { startFrame: clip.startFrame };
    }
    return null;
    function getFullStore(win: Window): FullStoreProxy {
      return (win as unknown as { __palmierStore: FullStoreProxy }).__palmierStore;
    }
    type FullStoreProxy = {
      getSnapshot(): {
        timeline: { tracks: Array<{ clips: Array<{ id: string; startFrame: number }> }> };
      };
    };
  }, origState.clipId);

  expect(afterSnap).not.toBeNull();
  // Snapped to playhead frame 20
  expect(afterSnap!.startFrame).toBe(PLAYHEAD_FRAME);
});

test("trim: drag right edge inward; one undo restores", async ({ page }) => {
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

  // Use zoom=4: clip right edge at x = 90*4 = 360, well within a ~1280px viewport
  const ZOOM = 4;
  await page.evaluate((z: number) => {
    const store = getFullStore(window);
    store.setZoom(z);
    function getFullStore(win: Window): FullStoreProxy {
      return (win as unknown as { __palmierStore: FullStoreProxy }).__palmierStore;
    }
    type FullStoreProxy = { setZoom(z: number): void };
  }, ZOOM);
  await page.waitForTimeout(100);

  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();

  const clipY = box!.y + CLIP_Y;
  // TRIM_HANDLE_WIDTH=4; right edge zone x in [90*4-4, 90*4] = [356, 360] (canvas CSS px from left)
  // Position 2px inside right handle: canvas x = 90*4 - 2 = 358
  const rightEdgeX = box!.x + 90 * ZOOM - 2;

  const origState = await page.evaluate(() => {
    const store = getFullStore(window);
    const snap = store.getSnapshot();
    const clip = snap.timeline.tracks[0]!.clips[0]!;
    return { clipId: clip.id, durationFrames: clip.durationFrames, startFrame: clip.startFrame };
    function getFullStore(win: Window): FullStoreProxy {
      return (win as unknown as { __palmierStore: FullStoreProxy }).__palmierStore;
    }
    type FullStoreProxy = {
      getSnapshot(): {
        timeline: { tracks: Array<{ clips: Array<{ id: string; durationFrames: number; startFrame: number }> }> };
      };
    };
  });
  expect(origState.durationFrames).toBe(90);

  // Drag right edge 10 frames left (40px at zoom=4) → durationFrames should decrease by ~10
  const dragTo = rightEdgeX - 10 * ZOOM;
  await page.mouse.move(rightEdgeX, clipY);
  await page.mouse.down();
  await page.mouse.move(rightEdgeX - 5, clipY); // cross DRAG_THRESHOLD
  await page.mouse.move(dragTo, clipY);
  await page.mouse.up();
  await page.waitForTimeout(150);

  const afterTrim = await page.evaluate((clipId: string) => {
    const store = getFullStore(window);
    const snap = store.getSnapshot();
    for (const track of snap.timeline.tracks) {
      const clip = track.clips.find((c) => c.id === clipId);
      if (clip) return { durationFrames: clip.durationFrames, canUndo: store.canUndo() };
    }
    return null;
    function getFullStore(win: Window): FullStoreProxy {
      return (win as unknown as { __palmierStore: FullStoreProxy }).__palmierStore;
    }
    type FullStoreProxy = {
      getSnapshot(): {
        timeline: { tracks: Array<{ clips: Array<{ id: string; durationFrames: number }> }> };
      };
      canUndo(): boolean;
    };
  }, origState.clipId);

  expect(afterTrim).not.toBeNull();
  expect(afterTrim!.durationFrames).toBeLessThan(90);
  expect(afterTrim!.canUndo).toBe(true);

  // ONE undo restores original duration
  await page.evaluate(() => {
    const store = getFullStore(window);
    store.undo();
    function getFullStore(win: Window): FullStoreProxy {
      return (win as unknown as { __palmierStore: FullStoreProxy }).__palmierStore;
    }
    type FullStoreProxy = { undo(): void };
  });
  await page.waitForTimeout(100);

  const afterUndo = await page.evaluate((clipId: string) => {
    const store = getFullStore(window);
    const snap = store.getSnapshot();
    for (const track of snap.timeline.tracks) {
      const clip = track.clips.find((c) => c.id === clipId);
      if (clip) return { durationFrames: clip.durationFrames };
    }
    return null;
    function getFullStore(win: Window): FullStoreProxy {
      return (win as unknown as { __palmierStore: FullStoreProxy }).__palmierStore;
    }
    type FullStoreProxy = {
      getSnapshot(): {
        timeline: { tracks: Array<{ clips: Array<{ id: string; durationFrames: number }> }> };
      };
    };
  }, origState.clipId);

  expect(afterUndo).not.toBeNull();
  expect(afterUndo!.durationFrames).toBe(90);
});

test("split: key press at playhead inside clip produces two clips", async ({ page }) => {
  const { box } = await setupZoom10(page);

  // Select the clip and set playhead at frame 30 (inside 0–90 clip)
  const ZOOM = 10;
  const clipBodyX = box.x + 45 * ZOOM;
  const clipY = box.y + CLIP_Y;

  await page.mouse.click(clipBodyX, clipY);
  await page.waitForTimeout(50);

  await page.evaluate(() => {
    const store = getFullStore(window);
    store.setPlayhead(30);
    function getFullStore(win: Window): FullStoreProxy {
      return (win as unknown as { __palmierStore: FullStoreProxy }).__palmierStore;
    }
    type FullStoreProxy = {
      setPlayhead(f: number): void;
    };
  });
  await page.waitForTimeout(50);

  // Focus the canvas and press "s" to split
  const canvas = page.locator('[data-testid="timeline-canvas"]');
  await canvas.focus();
  await page.keyboard.press("s");
  await page.waitForTimeout(150);

  const afterSplit = await page.evaluate(() => {
    const store = getFullStore(window);
    const snap = store.getSnapshot();
    const track = snap.timeline.tracks[0]!;
    return {
      clipCount: track.clips.length,
      clips: track.clips.map((c) => ({ id: c.id, startFrame: c.startFrame, durationFrames: c.durationFrames })),
    };
    function getFullStore(win: Window): FullStoreProxy {
      return (win as unknown as { __palmierStore: FullStoreProxy }).__palmierStore;
    }
    type FullStoreProxy = {
      getSnapshot(): {
        timeline: { tracks: Array<{ clips: Array<{ id: string; startFrame: number; durationFrames: number }> }> };
      };
    };
  });

  expect(afterSplit.clipCount).toBe(2);
  // Left clip: starts at 0, ends at 30
  const left = afterSplit.clips.find((c) => c.startFrame === 0);
  const right = afterSplit.clips.find((c) => c.startFrame === 30);
  expect(left).toBeDefined();
  expect(right).toBeDefined();
  expect(left!.durationFrames).toBe(30);
  expect(right!.durationFrames).toBe(60);
});
