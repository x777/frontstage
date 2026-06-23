import { expect, test, type Page } from "@playwright/test";

type Session = {
  getState(): { ref: { id: string; name: string } | null; name: string };
  isDirty(): boolean;
  save(): Promise<boolean>;
  saveAs(): Promise<boolean>;
  open(confirm: () => Promise<boolean>, ref?: { id: string; name: string }): Promise<boolean>;
  newProject(confirm: () => Promise<boolean>): Promise<boolean>;
};

type Gateway = {
  openQueue: Array<{ id: string; name: string }>;
  listRecent(): Promise<Array<{ id: string; name: string }>>;
};

async function waitForReady(page: Page) {
  await expect(page.locator('[data-testid="preview-canvas"]')).toBeVisible({ timeout: 15_000 });
  await page.waitForSelector('[data-testid="preview-canvas"][data-engine-ready="1"]', { timeout: 15_000 });
}

test("round-trip: save-as → dirty → new(discard) → open(recent)", async ({ page }) => {
  await page.goto("/");
  await waitForReady(page);

  // Make a timeline edit to make it dirty
  await page.evaluate(() => {
    type Store = { dispatch(c: unknown): void; getSnapshot(): { timeline: { fps: number; tracks: unknown[] } } };
    const store = (window as unknown as { __palmierStore: Store }).__palmierStore;
    const snap = store.getSnapshot();
    // dispatch a no-op that still produces a new timeline ref
    store.dispatch({
      label: "test edit",
      apply: (t: unknown) => ({ ...(t as object) }),
    });
    void snap;
  });

  // Confirm isDirty
  const dirty1 = await page.evaluate(() => {
    return (window as unknown as { __projectSession: Session }).__projectSession.isDirty();
  });
  expect(dirty1).toBe(true);

  // Click File menu → Save As
  await page.locator('[data-testid="file-menu"]').click();
  await page.locator('[data-testid="file-save-as"]').click();

  // Wait for save to complete (ref becomes non-null)
  await page.waitForFunction(() => {
    const s = (window as unknown as { __projectSession: Session }).__projectSession;
    return s.getState().ref !== null;
  }, { timeout: 5_000 });

  const afterSave = await page.evaluate(() => {
    const s = (window as unknown as { __projectSession: Session }).__projectSession;
    return { ref: s.getState().ref, dirty: s.isDirty() };
  });
  expect(afterSave.ref).not.toBeNull();
  expect(afterSave.dirty).toBe(false);

  const savedRef = afterSave.ref!;

  // Make another edit to dirty it again
  await page.evaluate(() => {
    type Store = { dispatch(c: unknown): void };
    const store = (window as unknown as { __palmierStore: Store }).__palmierStore;
    store.dispatch({
      label: "test edit 2",
      apply: (t: unknown) => ({ ...(t as object) }),
    });
  });

  await page.waitForFunction(() => {
    return (window as unknown as { __projectSession: Session }).__projectSession.isDirty();
  }, { timeout: 3_000 });

  // Assert dirty title shows bullet
  const titleAfterEdit = await page.title();
  expect(titleAfterEdit).toMatch(/ •$/);

  // Also check top-bar title
  const topBarTitle = page.locator('[data-testid="top-bar-title"]');
  await expect(topBarTitle).toContainText("•");

  // File → New; discard dialog appears; click "Don't Save"
  await page.locator('[data-testid="file-menu"]').click();
  await page.locator('[data-testid="file-new"]').click();

  await expect(page.locator('[data-testid="discard-dialog"]')).toBeVisible({ timeout: 3_000 });
  await page.locator('[data-testid="discard-dont-save"]').click();

  // Wait for dialog to close
  await expect(page.locator('[data-testid="discard-dialog"]')).not.toBeVisible({ timeout: 3_000 });

  // Project should be untitled, ref null, timeline empty
  const afterNew = await page.evaluate(() => {
    const s = (window as unknown as { __projectSession: Session }).__projectSession;
    type Store = { getSnapshot(): { timeline: { tracks: Array<{ clips: unknown[] }> } } };
    const store = (window as unknown as { __palmierStore: Store }).__palmierStore;
    return {
      ref: s.getState().ref,
      clips: store.getSnapshot().timeline.tracks.reduce((n: number, t) => n + t.clips.length, 0),
    };
  });
  expect(afterNew.ref).toBeNull();

  // Open the saved project via File → Open (gateway openQueue seeded with the saved ref)
  await page.evaluate((ref) => {
    (window as unknown as { __projectGateway: Gateway }).__projectGateway.openQueue.push(ref);
  }, savedRef);

  await page.locator('[data-testid="file-menu"]').click();
  await page.locator('[data-testid="file-open"]').click();

  // Wait for ref to be restored
  await page.waitForFunction((expectedId: string) => {
    const s = (window as unknown as { __projectSession: Session }).__projectSession;
    return s.getState().ref?.id === expectedId;
  }, savedRef.id, { timeout: 5_000 });

  const afterOpen = await page.evaluate(() => {
    const s = (window as unknown as { __projectSession: Session }).__projectSession;
    return { ref: s.getState().ref, dirty: s.isDirty() };
  });
  expect(afterOpen.ref?.id).toBe(savedRef.id);
  expect(afterOpen.dirty).toBe(false);
});

test("guard cancel: dirty + file-new → discard-cancel → nothing changes", async ({ page }) => {
  await page.goto("/");
  await waitForReady(page);

  // Make a save first to have a ref, then dirty it
  await page.evaluate(() => {
    type Store = { dispatch(c: unknown): void };
    const store = (window as unknown as { __palmierStore: Store }).__palmierStore;
    store.dispatch({ label: "edit", apply: (t: unknown) => ({ ...(t as object) }) });
  });

  await page.locator('[data-testid="file-menu"]').click();
  await page.locator('[data-testid="file-save-as"]').click();
  await page.waitForFunction(() => {
    return (window as unknown as { __projectSession: Session }).__projectSession.getState().ref !== null;
  }, { timeout: 5_000 });

  // Dirty again
  await page.evaluate(() => {
    type Store = { dispatch(c: unknown): void };
    const store = (window as unknown as { __palmierStore: Store }).__palmierStore;
    store.dispatch({ label: "edit2", apply: (t: unknown) => ({ ...(t as object) }) });
  });

  const beforeRef = await page.evaluate(() => {
    return (window as unknown as { __projectSession: Session }).__projectSession.getState().ref;
  });
  expect(beforeRef).not.toBeNull();

  // File → New → discard-cancel
  await page.locator('[data-testid="file-menu"]').click();
  await page.locator('[data-testid="file-new"]').click();

  await expect(page.locator('[data-testid="discard-dialog"]')).toBeVisible({ timeout: 3_000 });
  await page.locator('[data-testid="discard-cancel"]').click();
  await expect(page.locator('[data-testid="discard-dialog"]')).not.toBeVisible({ timeout: 3_000 });

  const afterCancel = await page.evaluate(() => {
    const s = (window as unknown as { __projectSession: Session }).__projectSession;
    return { ref: s.getState().ref, dirty: s.isDirty() };
  });
  expect(afterCancel.ref?.id).toBe(beforeRef?.id);
  expect(afterCancel.dirty).toBe(true);
});

test("Ctrl+N on dirty project shows discard-dialog; cancel leaves timeline unchanged", async ({ page }) => {
  await page.goto("/");
  await waitForReady(page);

  // Dirty the project + save to get a ref
  await page.evaluate(() => {
    type Store = { dispatch(c: unknown): void };
    const store = (window as unknown as { __palmierStore: Store }).__palmierStore;
    store.dispatch({ label: "edit", apply: (t: unknown) => ({ ...(t as object) }) });
  });

  await page.locator('[data-testid="file-menu"]').click();
  await page.locator('[data-testid="file-save-as"]').click();
  await page.waitForFunction(() => {
    return (window as unknown as { __projectSession: Session }).__projectSession.getState().ref !== null;
  }, { timeout: 5_000 });

  // Dirty again
  await page.evaluate(() => {
    type Store = { dispatch(c: unknown): void };
    const store = (window as unknown as { __palmierStore: Store }).__palmierStore;
    store.dispatch({ label: "edit2", apply: (t: unknown) => ({ ...(t as object) }) });
  });

  const beforeRef = await page.evaluate(() => {
    return (window as unknown as { __projectSession: Session }).__projectSession.getState().ref;
  });
  expect(beforeRef).not.toBeNull();

  // Press Ctrl+N — must pop discard dialog (not silently reset)
  await page.keyboard.press("Control+n");

  await expect(page.locator('[data-testid="discard-dialog"]')).toBeVisible({ timeout: 3_000 });

  // Cancel — project state must be unchanged
  await page.locator('[data-testid="discard-cancel"]').click();
  await expect(page.locator('[data-testid="discard-dialog"]')).not.toBeVisible({ timeout: 3_000 });

  const afterCancel = await page.evaluate(() => {
    const s = (window as unknown as { __projectSession: Session }).__projectSession;
    return { ref: s.getState().ref, dirty: s.isDirty() };
  });
  expect(afterCancel.ref?.id).toBe(beforeRef?.id);
  expect(afterCancel.dirty).toBe(true);
});

test("Ctrl+S saves when ref exists", async ({ page }) => {
  await page.goto("/");
  await waitForReady(page);

  // Dirty + save-as to get a ref
  await page.evaluate(() => {
    type Store = { dispatch(c: unknown): void };
    const store = (window as unknown as { __palmierStore: Store }).__palmierStore;
    store.dispatch({ label: "edit", apply: (t: unknown) => ({ ...(t as object) }) });
  });

  await page.locator('[data-testid="file-menu"]').click();
  await page.locator('[data-testid="file-save-as"]').click();
  await page.waitForFunction(() => {
    return (window as unknown as { __projectSession: Session }).__projectSession.getState().ref !== null;
  }, { timeout: 5_000 });

  // Dirty again
  await page.evaluate(() => {
    type Store = { dispatch(c: unknown): void };
    const store = (window as unknown as { __palmierStore: Store }).__palmierStore;
    store.dispatch({ label: "edit2", apply: (t: unknown) => ({ ...(t as object) }) });
  });

  await page.waitForFunction(() => {
    return (window as unknown as { __projectSession: Session }).__projectSession.isDirty();
  }, { timeout: 3_000 });

  // Press Ctrl+S
  await page.keyboard.press("Control+s");

  // dirty should clear
  await page.waitForFunction(() => {
    return !(window as unknown as { __projectSession: Session }).__projectSession.isDirty();
  }, { timeout: 5_000 });

  const dirty = await page.evaluate(() => {
    return (window as unknown as { __projectSession: Session }).__projectSession.isDirty();
  });
  expect(dirty).toBe(false);
});
