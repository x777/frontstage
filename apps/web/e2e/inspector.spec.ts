import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

type StoreProxy = {
  select(ids: string[]): void;
  dispatch(cmd: { label: string; coalesceKey?: string; apply(t: unknown): unknown }): void;
  undo(): void;
  canUndo(): boolean;
  getSnapshot(): {
    timeline: {
      tracks: Array<{
        clips: Array<{
          id: string;
          opacity: number;
          transform: { centerX: number };
          textContent?: string;
          mediaType: string;
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
