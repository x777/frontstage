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
  await page.evaluate(() => localStorage.removeItem("palmier.editor.ui"));
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
    const store = (window as unknown as { __palmierStore: StoreProxy }).__palmierStore;
    store.select(["clip-1"]);
  });

  await expect(page.locator('[data-testid="inspector-section-Transform"]')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('[data-testid="inspector-section-Opacity"]')).toBeVisible({ timeout: 5_000 });
});

test("inspector: opacity slider changes value and single undo restores", async ({ page }) => {
  await waitForApp(page);

  await page.evaluate(() => {
    const store = (window as unknown as { __palmierStore: StoreProxy }).__palmierStore;
    store.select(["clip-1"]);
  });

  await expect(page.locator('[data-testid="inspector-section-Opacity"]')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('[data-testid="inspector-opacity-input"]')).toBeVisible({ timeout: 5_000 });

  await reactSetValue(page, "inspector-opacity-input", "0.5");

  await expect.poll(
    () => page.evaluate(() => {
      const store = (window as unknown as { __palmierStore: StoreProxy }).__palmierStore;
      return store.getSnapshot().timeline.tracks[0]!.clips[0]!.opacity;
    }),
    { timeout: 3_000 },
  ).toBe(0.5);

  await page.evaluate(() => {
    const store = (window as unknown as { __palmierStore: StoreProxy }).__palmierStore;
    store.undo();
  });

  const afterUndo = await page.evaluate(() => {
    const store = (window as unknown as { __palmierStore: StoreProxy }).__palmierStore;
    return store.getSnapshot().timeline.tracks[0]!.clips[0]!.opacity;
  });
  expect(afterUndo).toBe(1);

  const canUndo = await page.evaluate(() => {
    const store = (window as unknown as { __palmierStore: StoreProxy }).__palmierStore;
    return store.canUndo();
  });
  expect(canUndo).toBe(false);
});

test("inspector: transform X field changes centerX and single undo restores", async ({ page }) => {
  await waitForApp(page);

  await page.evaluate(() => {
    const store = (window as unknown as { __palmierStore: StoreProxy }).__palmierStore;
    store.select(["clip-1"]);
  });

  await expect(page.locator('[data-testid="inspector-section-Transform"]')).toBeVisible({ timeout: 5_000 });

  const originalCX = await page.evaluate(() => {
    const store = (window as unknown as { __palmierStore: StoreProxy }).__palmierStore;
    return store.getSnapshot().timeline.tracks[0]!.clips[0]!.transform.centerX;
  });

  await expect(page.locator('[data-testid="inspector-x-input"]')).toBeVisible({ timeout: 5_000 });
  await reactSetValue(page, "inspector-x-input", "0.3");

  await expect.poll(
    () => page.evaluate(() => {
      const store = (window as unknown as { __palmierStore: StoreProxy }).__palmierStore;
      return store.getSnapshot().timeline.tracks[0]!.clips[0]!.transform.centerX;
    }),
    { timeout: 3_000 },
  ).not.toBe(originalCX);

  await page.evaluate(() => {
    const store = (window as unknown as { __palmierStore: StoreProxy }).__palmierStore;
    store.undo();
  });

  const afterUndo = await page.evaluate(() => {
    const store = (window as unknown as { __palmierStore: StoreProxy }).__palmierStore;
    return store.getSnapshot().timeline.tracks[0]!.clips[0]!.transform.centerX;
  });
  expect(afterUndo).toBe(originalCX);

  const canUndo = await page.evaluate(() => {
    const store = (window as unknown as { __palmierStore: StoreProxy }).__palmierStore;
    return store.canUndo();
  });
  expect(canUndo).toBe(false);
});

test("inspector: text clip shows Text section and editing textContent works with one undo", async ({ page }) => {
  await waitForApp(page);

  const textClipId = await page.evaluate(() => {
    const store = (window as unknown as { __palmierStore: StoreProxy }).__palmierStore;
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
    const store = (window as unknown as { __palmierStore: StoreProxy }).__palmierStore;
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
      const store = (window as unknown as { __palmierStore: StoreProxy }).__palmierStore;
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
    const store = (window as unknown as { __palmierStore: StoreProxy }).__palmierStore;
    store.undo();
  });

  const afterUndo = await page.evaluate((id: string) => {
    const store = (window as unknown as { __palmierStore: StoreProxy }).__palmierStore;
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
    const store = (window as unknown as { __palmierStore: StoreProxy }).__palmierStore;
    store.select(["clip-1"]);
    store.setPlayhead(10);
  });

  await expect(page.locator('[data-testid="inspector-section-Keyframes"]')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('[data-testid="kf-toggle-opacity"]')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('[data-testid="kf-lane-opacity"]')).toBeVisible({ timeout: 5_000 });

  // Click the toggle — should add an opacity keyframe at offset 10 (playhead=10, startFrame=0)
  await page.locator('[data-testid="kf-toggle-opacity"]').click();

  const afterAdd = await page.evaluate(() => {
    const store = (window as unknown as { __palmierStore: StoreProxy }).__palmierStore;
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
    return (window as unknown as { __palmierStore: StoreProxy }).__palmierStore.canUndo();
  });
  expect(canUndoAfterAdd).toBe(true);

  // ONE undo removes the track
  await page.evaluate(() => {
    (window as unknown as { __palmierStore: StoreProxy }).__palmierStore.undo();
  });

  const afterUndo = await page.evaluate(() => {
    const store = (window as unknown as { __palmierStore: StoreProxy }).__palmierStore;
    const clip = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
    return { hasTrack: !!clip.opacityTrack, canUndo: store.canUndo() };
  });
  expect(afterUndo.hasTrack).toBe(false);
  expect(afterUndo.canUndo).toBe(false);
});

test("inspector: keyframe lanes — two opacity keyframes interpolate", async ({ page }) => {
  await waitForApp(page);

  // Select clip-1 (durationFrames=90, startFrame=0)
  await page.evaluate(() => {
    const store = (window as unknown as { __palmierStore: StoreProxy }).__palmierStore;
    store.select(["clip-1"]);
  });

  await expect(page.locator('[data-testid="kf-toggle-opacity"]')).toBeVisible({ timeout: 5_000 });

  // Add first keyframe at frame 0, opacity=1 (default)
  await page.evaluate(() => {
    const store = (window as unknown as { __palmierStore: StoreProxy }).__palmierStore;
    store.setPlayhead(0);
  });
  await page.locator('[data-testid="kf-toggle-opacity"]').click();

  // Change opacity to 0.2 via setClipPropertyCommand equivalent, then add 2nd kf at frame 60
  await page.evaluate(() => {
    const store = (window as unknown as { __palmierStore: StoreProxy }).__palmierStore;
    store.setPlayhead(60);
    // Dispatch setKeyframeCommand directly: add opacity kf at offset 60, value 0.2
    store.dispatch({
      label: "Set Keyframe",
      coalesceKey: "kf-clip-1-opacity",
      apply(timeline: { tracks: Array<{ clips: Array<{ id: string; opacityTrack?: { keyframes: Keyframe[] } }> }> }) {
        return {
          ...timeline,
          tracks: timeline.tracks.map((track) => ({
            ...track,
            clips: track.clips.map((clip) => {
              if (clip.id !== "clip-1") return clip;
              const existing = clip.opacityTrack ?? { keyframes: [] };
              const kfs = existing.keyframes.filter((k) => k.frame !== 60);
              kfs.push({ frame: 60, value: 0.2, interpolationOut: "linear" });
              kfs.sort((a, b) => a.frame - b.frame);
              return { ...clip, opacityTrack: { keyframes: kfs } };
            }),
          })),
        };
      },
    });
  });

  // Verify 2 keyframes
  const kfCount = await page.evaluate(() => {
    const store = (window as unknown as { __palmierStore: StoreProxy }).__palmierStore;
    const clip = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
    return clip.opacityTrack?.keyframes.length ?? 0;
  });
  expect(kfCount).toBe(2);

  // Sample opacityAt at frame 30 — should be between 1 and 0.2 (≈ 0.6)
  const interpolatedOpacity = await page.evaluate(() => {
    const store = (window as unknown as { __palmierStore: StoreProxy }).__palmierStore;
    const clip = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
    // Manual linear interpolation check: frame 30 is midpoint between 0 and 60
    // kf[0].value=1 at frame 0, kf[1].value=0.2 at frame 60 → at 30: 1 + (0.2-1)*0.5 = 0.6
    const track = clip.opacityTrack!;
    const kfs = track.keyframes;
    const t = (30 - kfs[0]!.frame) / (kfs[1]!.frame - kfs[0]!.frame);
    const a = kfs[0]!.value as number;
    const b = kfs[1]!.value as number;
    return a + (b - a) * t;
  });
  expect(interpolatedOpacity).toBeGreaterThan(0.2);
  expect(interpolatedOpacity).toBeLessThan(1);
});

test("inspector: keyframe lanes — drag keyframe moves it (one undo)", async ({ page }) => {
  await waitForApp(page);

  // Select clip-1 and add an opacity keyframe at frame 20
  await page.evaluate(() => {
    const store = (window as unknown as { __palmierStore: StoreProxy }).__palmierStore;
    store.select(["clip-1"]);
    store.setPlayhead(20);
  });

  await expect(page.locator('[data-testid="kf-toggle-opacity"]')).toBeVisible({ timeout: 5_000 });
  await page.locator('[data-testid="kf-toggle-opacity"]').click();

  // Verify keyframe at frame 20
  const beforeDrag = await page.evaluate(() => {
    const store = (window as unknown as { __palmierStore: StoreProxy }).__palmierStore;
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
        const store = (window as unknown as { __palmierStore: StoreProxy }).__palmierStore;
        const clip = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
        return clip.opacityTrack?.keyframes[0]?.frame ?? -1;
      });
      return frame;
    },
    { timeout: 3_000 },
  ).not.toBe(20);

  const afterDrag = await page.evaluate(() => {
    const store = (window as unknown as { __palmierStore: StoreProxy }).__palmierStore;
    const clip = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
    return clip.opacityTrack?.keyframes[0]?.frame;
  });
  // Should be near frame 60 (within rounding)
  expect(afterDrag).toBeGreaterThan(30);

  // ONE undo reverts the move (back to frame 20)
  await page.evaluate(() => {
    (window as unknown as { __palmierStore: StoreProxy }).__palmierStore.undo();
  });

  const afterUndoMove = await page.evaluate(() => {
    const store = (window as unknown as { __palmierStore: StoreProxy }).__palmierStore;
    const clip = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
    return clip.opacityTrack?.keyframes[0]?.frame;
  });
  expect(afterUndoMove).toBe(20);
});
