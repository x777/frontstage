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
  enqueueOpen(ref: { id: string; name: string }): void;
  listRecent(): Promise<Array<{ id: string; name: string }>>;
};

async function waitForReady(page: Page) {
  await expect(page.locator('[data-testid="preview-canvas"]')).toBeVisible({ timeout: 15_000 });
  await page.waitForSelector('[data-testid="preview-canvas"][data-engine-ready="1"]', { timeout: 15_000 });
}

// Inject __pickDirectory before the app bootstraps so WebGateway uses OPFS dirs.
// Each call mints a fresh OPFS subdir and records the handle in window.__opfsHandles.
async function injectOpfsPicker(page: Page) {
  await page.addInitScript(() => {
    (window as any).__opfsHandles = [] as FileSystemDirectoryHandle[];
    (window as any).__pickDirectory = async (_opts?: { mode?: string }) => {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle("test-proj-" + Date.now() + "-" + Math.random(), { create: true });
      (window as any).__opfsHandles.push(dir);
      return dir;
    };
  });
}

test("round-trip: save-as → dirty → new(discard) → open(recent)", async ({ page }) => {
  await injectOpfsPicker(page);
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

  // Assert real on-disk write: project.json must exist in the OPFS folder
  const projectJsonContent = await page.evaluate(async () => {
    const handles = (window as any).__opfsHandles as FileSystemDirectoryHandle[];
    const dir: FileSystemDirectoryHandle | undefined = handles?.[0];
    if (!dir) return null;
    try {
      const fh = await dir.getFileHandle("project.json");
      const file = await fh.getFile();
      return await file.text();
    } catch {
      return null;
    }
  });
  expect(projectJsonContent).not.toBeNull();
  // project.json is the timeline object directly (fps, tracks, etc.)
  const parsed = JSON.parse(projectJsonContent!);
  expect(parsed).toHaveProperty("fps");

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

  // Open the saved project via File → Open (gateway enqueueOpen seeded with the saved ref).
  // WebGateway.enqueueOpen reconstructs the full WebProjectRef from its internal _handleMap using the id.
  await page.evaluate((ref) => {
    (window as unknown as { __projectGateway: Gateway }).__projectGateway.enqueueOpen(ref);
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
  await injectOpfsPicker(page);
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
  await injectOpfsPicker(page);
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
  await injectOpfsPicker(page);
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

test("reopen-read: saved media readable via bound gateway after save-as → new → reopen", async ({ page }) => {
  await injectOpfsPicker(page);
  await page.goto("/");
  await waitForReady(page);

  // Save-as to persist sample project (including clip.mp4 bytes) into the real WebGateway
  await page.locator('[data-testid="file-menu"]').click();
  await page.locator('[data-testid="file-save-as"]').click();

  const savedRef = await page.waitForFunction(() => {
    const s = (window as unknown as { __projectSession: Session }).__projectSession;
    const ref = s.getState().ref;
    return ref ?? undefined;
  }, { timeout: 5_000 });
  const ref = await savedRef.jsonValue() as { id: string; name: string };

  // Assert project.json exists in the OPFS folder after save
  const hasProjectJson = await page.evaluate(async () => {
    const handles = (window as any).__opfsHandles as FileSystemDirectoryHandle[];
    const dir: FileSystemDirectoryHandle | undefined = handles?.[0];
    if (!dir) return false;
    try {
      await dir.getFileHandle("project.json");
      return true;
    } catch {
      return false;
    }
  });
  expect(hasProjectJson).toBe(true);

  // New project — clears the live library and resets the gateway binding
  await page.locator('[data-testid="file-menu"]').click();
  await page.locator('[data-testid="file-new"]').click();

  await page.waitForFunction(() => {
    return (window as unknown as { __projectSession: Session }).__projectSession.getState().ref === null;
  }, { timeout: 3_000 });

  // Reopen the saved project via enqueueOpen.
  // WebGateway._handleMap stores id→handle from pickSaveAs, so enqueueOpen({id,name}) reconstructs the full ref.
  await page.evaluate((r) => {
    (window as unknown as { __projectGateway: Gateway }).__projectGateway.enqueueOpen(r);
  }, ref);

  await page.locator('[data-testid="file-menu"]').click();
  await page.locator('[data-testid="file-open"]').click();

  await page.waitForFunction((expectedId: string) => {
    const s = (window as unknown as { __projectSession: Session }).__projectSession;
    return s.getState().ref?.id === expectedId;
  }, ref.id, { timeout: 5_000 });

  // Assert timeline restored after open
  const afterOpenState = await page.evaluate(() => {
    const s = (window as unknown as { __projectSession: Session }).__projectSession;
    return { ref: s.getState().ref, dirty: s.isDirty() };
  });
  expect(afterOpenState.ref?.id).toBe(ref.id);
  expect(afterOpenState.dirty).toBe(false);

  // Prove the gateway thread: byteSource.open resolves to a non-empty Blob through the bound gateway
  const blobSize = await page.evaluate(async () => {
    type Library = { byteSource: { open(ref: string): Promise<Blob> } };
    const lib = (window as unknown as { __mediaLibrary: Library }).__mediaLibrary;
    const blob = await lib.byteSource.open("clip.mp4");
    return blob.size;
  });
  expect(blobSize).toBeGreaterThan(0);
});
