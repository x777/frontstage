import { expect, test } from "@playwright/test";

test("dirHandleProjectStore: readText/writeText round-trip + missing returns null", async ({ page }) => {
  await page.goto("/");
  // Wait for app (and web-fs-test-entry) to load
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__webfs, { timeout: 15_000 });

  const result = await page.evaluate(async () => {
    type WebFs = {
      dirHandleProjectStore: (dir: FileSystemDirectoryHandle) => {
        readText(name: string): Promise<string | null>;
        writeText(name: string, data: string): Promise<void>;
      };
    };
    const { dirHandleProjectStore } = (window as unknown as { __webfs: WebFs }).__webfs;

    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle("test-ps-" + Date.now(), { create: true });
    const store = dirHandleProjectStore(dir);

    await store.writeText("project.json", '{"a":1}');
    const read = await store.readText("project.json");
    const missing = await store.readText("missing.json");

    return { read, missing };
  });

  expect(result.read).toBe('{"a":1}');
  expect(result.missing).toBeNull();
});

test("WebMediaGateway: writeMedia/readMedia/hasMedia round-trip", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__webfs, { timeout: 15_000 });

  const result = await page.evaluate(async () => {
    type WebFs = {
      WebMediaGateway: new (dir: FileSystemDirectoryHandle) => {
        writeMedia(path: string, bytes: Uint8Array): Promise<void>;
        readMedia(path: string): Promise<Uint8Array>;
        hasMedia(path: string): Promise<boolean>;
      };
    };
    const { WebMediaGateway } = (window as unknown as { __webfs: WebFs }).__webfs;

    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle("test-mg-" + Date.now(), { create: true });
    const gw = new WebMediaGateway(dir);

    await gw.writeMedia("media/a.bin", new Uint8Array([1, 2, 3]));
    const bytes = await gw.readMedia("media/a.bin");
    const hasExisting = await gw.hasMedia("media/a.bin");
    const hasMissing = await gw.hasMedia("media/none.bin");

    let readMissingError = "";
    try {
      await gw.readMedia("media/none.bin");
    } catch (e) {
      readMissingError = (e as Error).message;
    }

    return {
      bytesArray: Array.from(bytes),
      hasExisting,
      hasMissing,
      readMissingError,
    };
  });

  expect(result.bytesArray).toEqual([1, 2, 3]);
  expect(result.hasExisting).toBe(true);
  expect(result.hasMissing).toBe(false);
  expect(result.readMissingError).toMatch(/media not found/);
});

test("WebMediaGateway: path guard rejects .. paths", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(() => !!(window as unknown as Record<string, unknown>).__webfs, { timeout: 15_000 });

  const result = await page.evaluate(async () => {
    type WebFs = {
      WebMediaGateway: new (dir: FileSystemDirectoryHandle) => {
        writeMedia(path: string, bytes: Uint8Array): Promise<void>;
      };
    };
    const { WebMediaGateway } = (window as unknown as { __webfs: WebFs }).__webfs;

    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle("test-guard-" + Date.now(), { create: true });
    const gw = new WebMediaGateway(dir);

    let evilError = "";
    try {
      await gw.writeMedia("../evil", new Uint8Array([0]));
    } catch (e) {
      evilError = (e as Error).message;
    }

    let noMediaPrefixError = "";
    try {
      await gw.writeMedia("other/file.bin", new Uint8Array([0]));
    } catch (e) {
      noMediaPrefixError = (e as Error).message;
    }

    return { evilError, noMediaPrefixError };
  });

  expect(result.evilError).toBeTruthy();
  expect(result.noMediaPrefixError).toBeTruthy();
});

// ── WebGateway tests ──────────────────────────────────────────────────────────

test("WebGateway: pickSaveAs + bind + write/read project + media round-trip", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>).__webgateway,
    { timeout: 15_000 },
  );

  const result = await page.evaluate(async () => {
    type WG = typeof import("../src/web-gateway.js");
    type IO = { writeProject: Function; readProject: Function };
    const { WebGateway } = (window as unknown as { __webgateway: WG & IO }).__webgateway;
    const { writeProject, readProject } = (window as unknown as { __webgateway: WG & IO }).__webgateway;

    const root = await navigator.storage.getDirectory();
    const opfsDir = await root.getDirectoryHandle("test-gw-" + Date.now(), { create: true });

    const gw = new WebGateway({ pickDirectory: async () => opfsDir, dbName: "test-gw-" + Date.now() });

    // pickSaveAs returns a ref
    const ref = await gw.pickSaveAs("MyProject");
    if (!ref) return { error: "pickSaveAs returned null" };

    const hasHandle = "handle" in ref;
    const hasId = typeof ref.id === "string" && ref.id.length > 0;
    const hasName = ref.name === opfsDir.name;

    // bind and write project
    const doc = {
      timeline: {
        fps: 30,
        width: 1920,
        height: 1080,
        settingsConfigured: true,
        tracks: [],
      },
      manifest: { items: {} },
      generationLog: { entries: [] },
    };

    const bound1 = await gw.bind(ref);
    await writeProject(bound1.store, doc);
    await bound1.media.writeMedia("media/a.bin", new Uint8Array([10, 20, 30]));

    // second bind + read back
    const bound2 = await gw.bind(ref);
    const readDoc = await readProject(bound2.store);
    const readBytes = await bound2.media.readMedia("media/a.bin");

    return {
      hasHandle,
      hasId,
      hasName,
      timelineFps: readDoc.timeline.fps,
      timelineWidth: readDoc.timeline.width,
      bytesArray: Array.from(readBytes),
    };
  });

  if ("error" in result) throw new Error(result.error as string);
  expect(result.hasHandle).toBe(true);
  expect(result.hasId).toBe(true);
  expect(result.hasName).toBe(true);
  expect(result.timelineFps).toBe(30);
  expect(result.timelineWidth).toBe(1920);
  expect(result.bytesArray).toEqual([10, 20, 30]);
});

test("WebGateway: addRecent / listRecent persists across instances / removeRecent clears", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>).__webgateway,
    { timeout: 15_000 },
  );

  const result = await page.evaluate(async () => {
    type WG = typeof import("../src/web-gateway.js");
    const { WebGateway } = (window as unknown as { __webgateway: WG }).__webgateway;

    const root = await navigator.storage.getDirectory();
    const opfsDir = await root.getDirectoryHandle("test-recent-" + Date.now(), { create: true });
    const dbName = "test-recent-" + Date.now();

    const gw1 = new WebGateway({ pickDirectory: async () => opfsDir, dbName });
    const ref = await gw1.pickOpen();
    if (!ref) return { error: "pickOpen returned null" };
    await gw1.addRecent(ref);

    // fresh gateway instance — same dbName
    const gw2 = new WebGateway({ pickDirectory: async () => opfsDir, dbName });
    const list = await gw2.listRecent();

    const found = list.find((r) => r.id === ref.id);
    const foundName = found?.name;
    const foundHasHandle = found ? "handle" in found : false;

    // removeRecent
    await gw2.removeRecent(ref);
    const listAfterRemove = await gw2.listRecent();
    const stillPresent = listAfterRemove.some((r) => r.id === ref.id);

    return { foundName, foundHasHandle, stillPresent, listLength: list.length };
  });

  if ("error" in result) throw new Error(result.error as string);
  expect(result.listLength).toBeGreaterThanOrEqual(1);
  expect(result.foundName).toBeTruthy();
  expect(result.foundHasHandle).toBe(true);
  expect(result.stillPresent).toBe(false);
});

test("WebGateway: pick-cancel resolves null", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(
    () => !!(window as unknown as Record<string, unknown>).__webgateway,
    { timeout: 15_000 },
  );

  const result = await page.evaluate(async () => {
    type WG = typeof import("../src/web-gateway.js");
    const { WebGateway } = (window as unknown as { __webgateway: WG }).__webgateway;

    const gw = new WebGateway({ pickDirectory: async () => null });
    const ref = await gw.pickOpen();
    return { isNull: ref === null };
  });

  expect(result.isNull).toBe(true);
});
