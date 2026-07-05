import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

type Keyframe = { frame: number; value: unknown; interpolationOut?: string };

type StoreProxy = {
  select(ids: string[]): void;
  setPlayhead(frame: number): void;
  dispatch(cmd: { label: string; coalesceKey?: string; apply(t: unknown): unknown }): void;
  undo(): void;
  canUndo(): boolean;
  getSnapshot(): {
    playhead: number;
    timeline: {
      tracks: Array<{
        clips: Array<{
          id: string;
          opacity: number;
          startFrame: number;
          durationFrames: number;
          transform: { centerX: number };
          textContent?: string;
          mediaType: string;
          opacityTrack?: { keyframes: Keyframe[] };
        }>;
      }>;
    };
  };
};

// Fire a React-compatible change on an input element.
// eval() is used here solely as a Playwright workaround: page.evaluate() only
// accepts serializable arguments, so we pass a literal function string from the
// test file (no user input) and eval it inside the browser context to get a
// callable. This is a known Playwright pattern — not a dynamic-input risk.
const reactChangeScript = `
(function(el, value) {
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  nativeInputValueSetter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
})
`;

async function waitForApp(page: Page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.removeItem("frontstage.editor.ui"));
  await page.reload();
  await page.waitForSelector('[data-testid="preview-canvas"]', { timeout: 15_000 });
  await page.waitForSelector('[data-testid="panel-inspector"]', { timeout: 10_000 });
}

async function reactSetValue(page: Page, testId: string, value: string) {
  await page.locator(`[data-testid="${testId}"]`).evaluate(
    (el: HTMLInputElement, { script, val }: { script: string; val: string }) => {
      const fn = eval(script) as (el: HTMLInputElement, v: string) => void;
      fn(el, val);
    },
    { script: reactChangeScript, val: value },
  );
}

test("inspector: Transform + Opacity sections appear when video clip selected", async ({ page }) => {
  await waitForApp(page);

  await page.evaluate(() => {
    const store = (window as unknown as { __frontstageStore: StoreProxy }).__frontstageStore;
    store.select(["clip-1"]);
  });

  await expect(page.locator('[data-testid="inspector-section-Transform"]')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('[data-testid="inspector-section-Opacity"]')).toBeVisible({ timeout: 5_000 });
});

test("inspector: opacity slider changes value and single undo restores", async ({ page }) => {
  await waitForApp(page);

  await page.evaluate(() => {
    const store = (window as unknown as { __frontstageStore: StoreProxy }).__frontstageStore;
    store.select(["clip-1"]);
  });

  await expect(page.locator('[data-testid="inspector-section-Opacity"]')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('[data-testid="inspector-opacity-input"]')).toBeVisible({ timeout: 5_000 });

  await reactSetValue(page, "inspector-opacity-input", "0.5");

  await expect.poll(
    () => page.evaluate(() => {
      const store = (window as unknown as { __frontstageStore: StoreProxy }).__frontstageStore;
      return store.getSnapshot().timeline.tracks[0]!.clips[0]!.opacity;
    }),
    { timeout: 3_000 },
  ).toBe(0.5);

  await page.evaluate(() => {
    const store = (window as unknown as { __frontstageStore: StoreProxy }).__frontstageStore;
    store.undo();
  });

  const afterUndo = await page.evaluate(() => {
    const store = (window as unknown as { __frontstageStore: StoreProxy }).__frontstageStore;
    return store.getSnapshot().timeline.tracks[0]!.clips[0]!.opacity;
  });
  expect(afterUndo).toBe(1);

  const canUndo = await page.evaluate(() => {
    const store = (window as unknown as { __frontstageStore: StoreProxy }).__frontstageStore;
    return store.canUndo();
  });
  expect(canUndo).toBe(false);
});

test("inspector: transform X field changes centerX and single undo restores", async ({ page }) => {
  await waitForApp(page);

  await page.evaluate(() => {
    const store = (window as unknown as { __frontstageStore: StoreProxy }).__frontstageStore;
    store.select(["clip-1"]);
  });

  await expect(page.locator('[data-testid="inspector-section-Transform"]')).toBeVisible({ timeout: 5_000 });

  const originalCX = await page.evaluate(() => {
    const store = (window as unknown as { __frontstageStore: StoreProxy }).__frontstageStore;
    return store.getSnapshot().timeline.tracks[0]!.clips[0]!.transform.centerX;
  });

  await expect(page.locator('[data-testid="inspector-x-input"]')).toBeVisible({ timeout: 5_000 });
  await reactSetValue(page, "inspector-x-input", "0.3");

  await expect.poll(
    () => page.evaluate(() => {
      const store = (window as unknown as { __frontstageStore: StoreProxy }).__frontstageStore;
      return store.getSnapshot().timeline.tracks[0]!.clips[0]!.transform.centerX;
    }),
    { timeout: 3_000 },
  ).not.toBe(originalCX);

  await page.evaluate(() => {
    const store = (window as unknown as { __frontstageStore: StoreProxy }).__frontstageStore;
    store.undo();
  });

  const afterUndo = await page.evaluate(() => {
    const store = (window as unknown as { __frontstageStore: StoreProxy }).__frontstageStore;
    return store.getSnapshot().timeline.tracks[0]!.clips[0]!.transform.centerX;
  });
  expect(afterUndo).toBe(originalCX);

  const canUndo = await page.evaluate(() => {
    const store = (window as unknown as { __frontstageStore: StoreProxy }).__frontstageStore;
    return store.canUndo();
  });
  expect(canUndo).toBe(false);
});

test("inspector: text clip shows Text section and editing textContent works with one undo", async ({ page }) => {
  await waitForApp(page);

  const textClipId = await page.evaluate(() => {
    const store = (window as unknown as { __frontstageStore: StoreProxy }).__frontstageStore;
    const id = "test-text-clip-1";
    const textClip = {
      id,
      mediaRef: "text-clip",
      mediaType: "text",
      sourceClipType: "text",
      startFrame: 0,
      durationFrames: 90,
      trimStartFrame: 0,
      trimEndFrame: 0,
      speed: 1,
      volume: 1,
      fadeInFrames: 0,
      fadeOutFrames: 0,
      fadeInInterpolation: "linear",
      fadeOutInterpolation: "linear",
      opacity: 1,
      transform: { centerX: 0.5, centerY: 0.5, width: 1, height: 1, rotation: 0, flipHorizontal: false, flipVertical: false },
      crop: { top: 0, bottom: 0, left: 0, right: 0 },
      textContent: "Hi",
    };
    const newTrack = {
      id: "track-text-1",
      type: "text",
      muted: false,
      hidden: false,
      syncLocked: false,
      clips: [textClip],
    };
    store.dispatch({
      label: "Add Text Track",
      apply(timeline: { tracks: unknown[] }) {
        return { ...timeline, tracks: [...timeline.tracks, newTrack] };
      },
    });
    return id;
  });

  await page.evaluate((id: string) => {
    const store = (window as unknown as { __frontstageStore: StoreProxy }).__frontstageStore;
    store.select([id]);
  }, textClipId);

  await expect(page.locator('[data-testid="inspector-section-Text"]')).toBeVisible({ timeout: 5_000 });

  await expect(page.locator('[data-testid="inspector-content-input"]')).toBeVisible({ timeout: 5_000 });

  // For text inputs we need React's native setter too
  await page.locator('[data-testid="inspector-content-input"]').evaluate(
    (el: HTMLInputElement, { script, val }: { script: string; val: string }) => {
      const fn = eval(script) as (el: HTMLInputElement, v: string) => void;
      fn(el, val);
    },
    { script: reactChangeScript, val: "Hello World" },
  );

  await expect.poll(
    () => page.evaluate((id: string) => {
      const store = (window as unknown as { __frontstageStore: StoreProxy }).__frontstageStore;
      const snap = store.getSnapshot();
      for (const track of snap.timeline.tracks) {
        for (const clip of track.clips) {
          if (clip.id === id) return clip.textContent;
        }
      }
      return undefined;
    }, textClipId),
    { timeout: 3_000 },
  ).toBe("Hello World");

  await page.evaluate(() => {
    const store = (window as unknown as { __frontstageStore: StoreProxy }).__frontstageStore;
    store.undo();
  });

  const afterUndo = await page.evaluate((id: string) => {
    const store = (window as unknown as { __frontstageStore: StoreProxy }).__frontstageStore;
    const snap = store.getSnapshot();
    for (const track of snap.timeline.tracks) {
      for (const clip of track.clips) {
        if (clip.id === id) return clip.textContent;
      }
    }
    return undefined;
  }, textClipId);
  expect(afterUndo).toBe("Hi");
});

test("inspector: keyframe lanes — opacity toggle adds/removes keyframe (one undo)", async ({ page }) => {
  await waitForApp(page);

  // Select clip-1 and make sure the Keyframes section is visible
  await page.evaluate(() => {
    const store = (window as unknown as { __frontstageStore: StoreProxy }).__frontstageStore;
    store.select(["clip-1"]);
    store.setPlayhead(10);
  });

  await expect(page.locator('[data-testid="inspector-section-Keyframes"]')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('[data-testid="kf-toggle-opacity"]')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('[data-testid="kf-lane-opacity"]')).toBeVisible({ timeout: 5_000 });

  // Click the toggle — should add an opacity keyframe at offset 10 (playhead=10, startFrame=0)
  await page.locator('[data-testid="kf-toggle-opacity"]').click();

  const afterAdd = await page.evaluate(() => {
    const store = (window as unknown as { __frontstageStore: StoreProxy }).__frontstageStore;
    const clip = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
    return {
      hasTrack: !!clip.opacityTrack,
      kfCount: clip.opacityTrack?.keyframes.length ?? 0,
      kfFrame: clip.opacityTrack?.keyframes[0]?.frame,
      kfValue: clip.opacityTrack?.keyframes[0]?.value,
    };
  });

  expect(afterAdd.hasTrack).toBe(true);
  expect(afterAdd.kfCount).toBe(1);
  expect(afterAdd.kfFrame).toBe(10);
  // value ≈ current opacity (1)
  expect(typeof afterAdd.kfValue).toBe("number");
  expect(afterAdd.kfValue as number).toBeGreaterThanOrEqual(0.9);

  // canUndo must be true
  const canUndoAfterAdd = await page.evaluate(() => {
    return (window as unknown as { __frontstageStore: StoreProxy }).__frontstageStore.canUndo();
  });
  expect(canUndoAfterAdd).toBe(true);

  // ONE undo removes the track
  await page.evaluate(() => {
    (window as unknown as { __frontstageStore: StoreProxy }).__frontstageStore.undo();
  });

  const afterUndo = await page.evaluate(() => {
    const store = (window as unknown as { __frontstageStore: StoreProxy }).__frontstageStore;
    const clip = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
    return { hasTrack: !!clip.opacityTrack, canUndo: store.canUndo() };
  });
  expect(afterUndo.hasTrack).toBe(false);
  expect(afterUndo.canUndo).toBe(false);
});

test("inspector: keyframe lanes — two opacity keyframes interpolate (preview pixel)", async ({ page }) => {
  await waitForApp(page);
  // Wait for engine ready so pixel reads are valid
  await page.waitForSelector('[data-testid="preview-canvas"][data-engine-ready="1"]', { timeout: 10_000 });

  // Select clip-1 (durationFrames=90, startFrame=0, mediaType=video)
  await page.evaluate(() => {
    const store = (window as unknown as { __frontstageStore: StoreProxy }).__frontstageStore;
    store.select(["clip-1"]);
  });

  await expect(page.locator('[data-testid="kf-toggle-opacity"]')).toBeVisible({ timeout: 5_000 });

  // Set kf at frame 0: opacity=1 (toggle adds current value via opacityAt)
  await page.evaluate(() => {
    const store = (window as unknown as { __frontstageStore: StoreProxy }).__frontstageStore;
    store.setPlayhead(0);
  });
  await page.locator('[data-testid="kf-toggle-opacity"]').click();

  // Set kf at frame 60: opacity≈0 — dispatch directly so the value is clearly 0
  await page.evaluate(() => {
    const store = (window as unknown as { __frontstageStore: StoreProxy }).__frontstageStore;
    store.dispatch({
      label: "Set Keyframe",
      coalesceKey: "kf-clip-1-opacity-end",
      apply(timeline: { tracks: Array<{ clips: Array<{ id: string; opacityTrack?: { keyframes: Keyframe[] } }> }> }) {
        return {
          ...timeline,
          tracks: timeline.tracks.map((track) => ({
            ...track,
            clips: track.clips.map((clip) => {
              if (clip.id !== "clip-1") return clip;
              const existing = clip.opacityTrack ?? { keyframes: [] };
              const kfs = existing.keyframes.filter((k) => k.frame !== 60);
              kfs.push({ frame: 60, value: 0, interpolationOut: "linear" });
              kfs.sort((a, b) => a.frame - b.frame);
              return { ...clip, opacityTrack: { keyframes: kfs } };
            }),
          })),
        };
      },
    });
  });

  // Verify 2 keyframes with correct values
  const kfCount = await page.evaluate(() => {
    const store = (window as unknown as { __frontstageStore: StoreProxy }).__frontstageStore;
    const clip = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
    return clip.opacityTrack?.keyframes.length ?? 0;
  });
  expect(kfCount).toBe(2);

  // Helper: seek playhead and read the center pixel after the engine settles
  const readPixelAtFrame = async (frame: number): Promise<[number, number, number, number]> => {
    await page.evaluate((f: number) => {
      const store = (window as unknown as { __frontstageStore: StoreProxy }).__frontstageStore;
      store.setPlayhead(f);
    }, frame);
    // Give the engine time to seek and render the frame
    await page.waitForTimeout(600);
    return page.evaluate(async () => {
      const canvas = document.querySelector('[data-testid="preview-canvas"]') as
        | (HTMLCanvasElement & { __readPixel?: (x: number, y: number) => Promise<[number, number, number, number]> })
        | null;
      if (!canvas?.__readPixel) return [0, 0, 0, 0] as [number, number, number, number];
      return canvas.__readPixel(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2));
    });
  };

  // AT frame 0: opacity=1 → pixel should be the video frame's color (non-zero)
  const pixelAtKf0 = await readPixelAtFrame(0);

  // MID frame 30: linear interpolation → opacity≈0.5 → pixel alpha/brightness is intermediate
  const pixelAtMid = await readPixelAtFrame(30);

  // The two readings must differ: interpolation changed the rendered opacity between them.
  // Compare summed RGB brightness — at kf0 (opacity 1) it is higher than at mid (opacity 0.5).
  const brightnessAt0 = pixelAtKf0[0] + pixelAtKf0[1] + pixelAtKf0[2];
  const brightnessAtMid = pixelAtMid[0] + pixelAtMid[1] + pixelAtMid[2];
  // Midpoint should be distinctly dimmer than the fully-opaque frame.
  // Tolerance: allow up to 80% of the full brightness (i.e., must differ by at least 20%).
  expect(brightnessAtMid).toBeLessThan(brightnessAt0 * 0.8);
});

test("inspector: keyframe lanes — drag keyframe moves it (one undo)", async ({ page }) => {
  await waitForApp(page);

  // Select clip-1 and add an opacity keyframe at frame 20
  await page.evaluate(() => {
    const store = (window as unknown as { __frontstageStore: StoreProxy }).__frontstageStore;
    store.select(["clip-1"]);
    store.setPlayhead(20);
  });

  await expect(page.locator('[data-testid="kf-toggle-opacity"]')).toBeVisible({ timeout: 5_000 });
  await page.locator('[data-testid="kf-toggle-opacity"]').click();

  // Verify keyframe at frame 20
  const beforeDrag = await page.evaluate(() => {
    const store = (window as unknown as { __frontstageStore: StoreProxy }).__frontstageStore;
    const clip = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
    return clip.opacityTrack?.keyframes[0]?.frame;
  });
  expect(beforeDrag).toBe(20);

  // Drag the keyframe in the lane. The lane maps [0, durationFrames=90] to lane width.
  // We'll simulate a pointer drag from where frame 20 sits to where frame 60 would sit.
  const lane = page.locator('[data-testid="kf-lane-opacity"]');
  const laneBox = await lane.boundingBox();
  expect(laneBox).not.toBeNull();

  const laneWidth = laneBox!.width;
  const laneLeft = laneBox!.x;
  const laneCenterY = laneBox!.y + laneBox!.height / 2;

  // x of frame 20 in lane = (20/90) * laneWidth
  const startX = laneLeft + (20 / 90) * laneWidth;
  // x of frame 60 in lane = (60/90) * laneWidth
  const endX = laneLeft + (60 / 90) * laneWidth;

  await page.mouse.move(startX, laneCenterY);
  await page.mouse.down();
  // Move in small steps to ensure pointermove events fire
  await page.mouse.move(startX + (endX - startX) * 0.5, laneCenterY);
  await page.mouse.move(endX, laneCenterY);
  await page.mouse.up();

  // Wait for store to update
  await expect.poll(
    async () => {
      const frame = await page.evaluate(() => {
        const store = (window as unknown as { __frontstageStore: StoreProxy }).__frontstageStore;
        const clip = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
        return clip.opacityTrack?.keyframes[0]?.frame ?? -1;
      });
      return frame;
    },
    { timeout: 3_000 },
  ).not.toBe(20);

  const afterDrag = await page.evaluate(() => {
    const store = (window as unknown as { __frontstageStore: StoreProxy }).__frontstageStore;
    const clip = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
    return clip.opacityTrack?.keyframes[0]?.frame;
  });
  // Should be near frame 60 (within rounding)
  expect(afterDrag).toBeGreaterThan(30);

  // ONE undo reverts the move (back to frame 20)
  await page.evaluate(() => {
    (window as unknown as { __frontstageStore: StoreProxy }).__frontstageStore.undo();
  });

  const afterUndoMove = await page.evaluate(() => {
    const store = (window as unknown as { __frontstageStore: StoreProxy }).__frontstageStore;
    const clip = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
    return clip.opacityTrack?.keyframes[0]?.frame;
  });
  expect(afterUndoMove).toBe(20);
});
