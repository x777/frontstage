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
