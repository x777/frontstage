import { test, expect, afterEach, vi } from "vitest";
import type { MediaFolder, MediaManifestEntry } from "@palmier/core";
import { decodeProjectFiles, defaultTimeline, emptyGenerationLog, encodeProjectFiles, PROJECT_FILES } from "@palmier/core";
import { MediaLibrary } from "../src/media/media-library.js";

function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function placeholderEntry(id: string): MediaManifestEntry {
  return {
    id,
    name: "gen.mp4",
    type: "video",
    source: { kind: "project", relativePath: `media/gen-${id}.mp4` },
    duration: 5,
    generationStatus: "preparing",
  };
}

function realEntry(id: string): MediaManifestEntry {
  return {
    id,
    name: "clip.mp4",
    type: "video",
    source: { kind: "project", relativePath: `media/${id}.mp4` },
    duration: 3,
  };
}

test("addPlaceholder: appears in snapshot with preparing status and no pending bytes", () => {
  const lib = new MediaLibrary();
  const entry = placeholderEntry("a");
  lib.addPlaceholder(entry);

  const snap = lib.getSnapshot();
  expect(snap.entries).toHaveLength(1);
  expect(snap.entries[0]?.id).toBe("a");
  expect(snap.entries[0]?.generationStatus).toBe("preparing");
  expect(lib.pendingMedia().has(entry.source.kind === "project" ? entry.source.relativePath : "")).toBe(false);
  expect(lib.pendingMedia().size).toBe(0);
});

test("addPlaceholder: emits once", () => {
  const lib = new MediaLibrary();
  let calls = 0;
  lib.subscribe(() => calls++);
  lib.addPlaceholder(placeholderEntry("a"));
  expect(calls).toBe(1);
});

test("patchEntry: updates the named entry by id, leaves others untouched by reference", () => {
  const lib = new MediaLibrary();
  const a = realEntry("a");
  const b = realEntry("b");
  lib.addEntry(a, new Uint8Array([1]));
  lib.addEntry(b, new Uint8Array([2]));

  lib.patchEntry("a", { duration: 42 });

  const snap = lib.getSnapshot();
  const patchedA = snap.entries.find((e) => e.id === "a");
  const untouchedB = snap.entries.find((e) => e.id === "b");
  expect(patchedA?.duration).toBe(42);
  expect(patchedA).not.toBe(a);
  expect(untouchedB).toBe(b);
});

test("patchEntry: no-op for unknown id", () => {
  const lib = new MediaLibrary();
  const a = realEntry("a");
  lib.addEntry(a, new Uint8Array([1]));

  let calls = 0;
  lib.subscribe(() => calls++);
  lib.patchEntry("missing", { duration: 99 });

  const snap = lib.getSnapshot();
  expect(snap.entries).toHaveLength(1);
  expect(snap.entries[0]).toBe(a);
  // still a no-op operation; emit-on-noop is acceptable either way, only entries must be unchanged
  expect(calls).toBeLessThanOrEqual(1);
});

test("finalizeGenerated: lands bytes at reserved relativePath, clears status, applies patch", () => {
  const lib = new MediaLibrary();
  const placeholder = placeholderEntry("a");
  lib.addPlaceholder(placeholder);

  const bytes = new Uint8Array([9, 9, 9]);
  lib.finalizeGenerated("a", bytes, { duration: 12, sourceWidth: 640, sourceHeight: 360 });

  const relativePath = placeholder.source.kind === "project" ? placeholder.source.relativePath : "";
  const pending = lib.pendingMedia();
  expect(pending.get(relativePath)).toEqual(bytes);

  const snap = lib.getSnapshot();
  const finalized = snap.entries.find((e) => e.id === "a");
  expect(finalized?.generationStatus).toBeUndefined();
  expect(finalized?.duration).toBe(12);
  expect(finalized?.sourceWidth).toBe(640);
  expect(finalized?.sourceHeight).toBe(360);
});

test("finalizeGenerated: emits once", () => {
  const lib = new MediaLibrary();
  const placeholder = placeholderEntry("a");
  lib.addPlaceholder(placeholder);

  let calls = 0;
  lib.subscribe(() => calls++);
  lib.finalizeGenerated("a", new Uint8Array([1]), { duration: 12 });
  expect(calls).toBe(1);
});

test("markGenerationFailed: stamps the message on all listed ids in one emit", () => {
  const lib = new MediaLibrary();
  lib.addPlaceholder(placeholderEntry("a"));
  lib.addPlaceholder(placeholderEntry("b"));
  lib.addPlaceholder(placeholderEntry("c"));

  let calls = 0;
  lib.subscribe(() => calls++);
  lib.markGenerationFailed(["a", "b"], "boom");

  const snap = lib.getSnapshot();
  expect(snap.entries.find((e) => e.id === "a")?.generationStatus).toBe("failed: boom");
  expect(snap.entries.find((e) => e.id === "b")?.generationStatus).toBe("failed: boom");
  expect(snap.entries.find((e) => e.id === "c")?.generationStatus).toBe("preparing");
  expect(calls).toBe(1);
});

test("bytesFor: returns in-memory bytes for a project-source entry added via addEntry", () => {
  const lib = new MediaLibrary();
  const entry = realEntry("a");
  const bytes = new Uint8Array([1, 2, 3]);
  lib.addEntry(entry, bytes);

  expect(lib.bytesFor(entry)).toEqual(bytes);
});

test("bytesFor: undefined for an entry with no in-memory bytes (placeholder, not yet finalized)", () => {
  const lib = new MediaLibrary();
  const entry = placeholderEntry("a");
  lib.addPlaceholder(entry);

  expect(lib.bytesFor(entry)).toBeUndefined();
});

test("bytesFor: undefined for a non-project source", () => {
  const lib = new MediaLibrary();
  const entry: MediaManifestEntry = { id: "x", name: "ext.mp4", type: "video", source: { kind: "external", absolutePath: "/tmp/x.mp4" }, duration: 1 };

  expect(lib.bytesFor(entry)).toBeUndefined();
});

test("readMedia: delegates to the configured gateway", async () => {
  const lib = new MediaLibrary();
  const reads: string[] = [];
  lib.setGateway({
    writeMedia: async () => {},
    readMedia: async (rel) => { reads.push(rel); return new Uint8Array([9, 9]); },
    hasMedia: async () => true,
  });

  const bytes = await lib.readMedia("media/a.mp4");

  expect(bytes).toEqual(new Uint8Array([9, 9]));
  expect(reads).toEqual(["media/a.mp4"]);
});

test("readMedia: throws when no gateway is configured", async () => {
  const lib = new MediaLibrary();
  await expect(lib.readMedia("media/a.mp4")).rejects.toThrow(/gateway/);
});

test("writeDerived: lands bytes in pendingMedia at the given path and emits", () => {
  const lib = new MediaLibrary();
  let calls = 0;
  lib.subscribe(() => calls++);

  const bytes = new Uint8Array([1, 2, 3]);
  lib.writeDerived("media/a.transcript.json", bytes);

  expect(lib.pendingMedia().get("media/a.transcript.json")).toEqual(bytes);
  expect(calls).toBe(1);
});

test("writeDerived: overwrites a prior write at the same path", () => {
  const lib = new MediaLibrary();
  lib.writeDerived("media/a.transcript.json", new Uint8Array([1]));
  lib.writeDerived("media/a.transcript.json", new Uint8Array([2, 2]));

  expect(lib.pendingMedia().get("media/a.transcript.json")).toEqual(new Uint8Array([2, 2]));
});

test("readDerived: returns in-memory bytes written via writeDerived without touching the gateway", async () => {
  const lib = new MediaLibrary();
  const reads: string[] = [];
  lib.setGateway({
    writeMedia: async () => {},
    readMedia: async (rel) => { reads.push(rel); return new Uint8Array([9]); },
    hasMedia: async () => true,
  });
  lib.writeDerived("media/a.transcript.json", new Uint8Array([1, 2, 3]));

  const bytes = await lib.readDerived("media/a.transcript.json");

  expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
  expect(reads).toEqual([]);
});

test("readDerived: falls back to the gateway when not held in memory", async () => {
  const lib = new MediaLibrary();
  lib.setGateway({
    writeMedia: async () => {},
    readMedia: async () => new Uint8Array([7, 7]),
    hasMedia: async () => true,
  });

  const bytes = await lib.readDerived("media/a.transcript.json");

  expect(bytes).toEqual(new Uint8Array([7, 7]));
});

test("readDerived: null (not a throw) when neither in-memory bytes nor a gateway are available", async () => {
  const lib = new MediaLibrary();
  await expect(lib.readDerived("media/missing.transcript.json")).resolves.toBeNull();
});

test("loadManifest: folders and an entry's folderId survive an untouched round trip through getManifest (regression)", () => {
  const lib = new MediaLibrary();
  const folder: MediaFolder = { id: "f1", name: "B-roll" };
  const entry = realEntry("a");
  entry.folderId = "f1";

  lib.loadManifest({ version: 2, entries: [entry], folders: [folder] }, null);

  const manifest = lib.getManifest();
  expect(manifest.folders).toEqual([folder]);
  expect(manifest.entries[0]?.folderId).toBe("f1");
});

test("loadManifest -> getManifest folders round-trip through encodeProjectFiles/decodeProjectFiles", () => {
  const lib = new MediaLibrary();
  const folder: MediaFolder = { id: "f1", name: "B-roll" };
  const entry = realEntry("a");
  entry.folderId = "f1";
  lib.loadManifest({ version: 2, entries: [entry], folders: [folder] }, null);

  const files = encodeProjectFiles({
    timeline: defaultTimeline(),
    manifest: lib.getManifest(),
    generationLog: emptyGenerationLog(),
  });
  const decoded = decodeProjectFiles({
    timeline: files[PROJECT_FILES.timeline]!,
    manifest: files[PROJECT_FILES.manifest],
    generationLog: files[PROJECT_FILES.generationLog],
  });

  expect(decoded.manifestUnreadable).toBe(false);
  expect(decoded.manifest.folders).toEqual([folder]);
  expect(decoded.manifest.entries[0]?.folderId).toBe("f1");
});

test("readDerived: null when the gateway rejects (e.g. file not found)", async () => {
  const lib = new MediaLibrary();
  lib.setGateway({
    writeMedia: async () => {},
    readMedia: async () => { throw new Error("not found"); },
    hasMedia: async () => false,
  });

  await expect(lib.readDerived("media/missing.transcript.json")).resolves.toBeNull();
});

// ── folder / entry ops (T2) ─────────────────────────────────────────────────

test("createFolder: appends a folder at root and emits", () => {
  const lib = new MediaLibrary();
  let calls = 0;
  lib.subscribe(() => calls++);

  const folder = lib.createFolder("B-roll");

  expect(folder.name).toBe("B-roll");
  expect(folder.parentFolderId).toBeUndefined();
  expect(lib.getManifest().folders).toEqual([folder]);
  expect(calls).toBe(1);
});

test("createFolder: nests under an existing parent", () => {
  const lib = new MediaLibrary();
  const parent = lib.createFolder("Parent");
  const child = lib.createFolder("Child", parent.id);

  expect(child.parentFolderId).toBe(parent.id);
  expect(lib.getManifest().folders).toEqual([parent, child]);
});

test("createFolder: throws on unknown parentFolderId, no mutation", () => {
  const lib = new MediaLibrary();
  expect(() => lib.createFolder("Orphan", "missing")).toThrow(/missing/);
  expect(lib.getManifest().folders).toHaveLength(0);
});

test("renameFolder: updates name and emits", () => {
  const lib = new MediaLibrary();
  const folder = lib.createFolder("Old");
  let calls = 0;
  lib.subscribe(() => calls++);

  lib.renameFolder(folder.id, "New");

  expect(lib.getManifest().folders[0]?.name).toBe("New");
  expect(calls).toBe(1);
});

test("renameFolder: throws on unknown id", () => {
  const lib = new MediaLibrary();
  expect(() => lib.renameFolder("missing", "New")).toThrow(/missing/);
});

test("renameEntry: updates name, leaves other fields untouched", () => {
  const lib = new MediaLibrary();
  const entry = realEntry("a");
  lib.addEntry(entry, new Uint8Array([1]));

  lib.renameEntry("a", "renamed.mp4");

  const found = lib.getSnapshot().entries.find((e) => e.id === "a");
  expect(found?.name).toBe("renamed.mp4");
  expect(found?.duration).toBe(entry.duration);
});

test("renameEntry: throws on unknown id", () => {
  const lib = new MediaLibrary();
  expect(() => lib.renameEntry("missing", "x")).toThrow(/missing/);
});

test("moveEntriesToFolder: sets folderId on the given assets", () => {
  const lib = new MediaLibrary();
  const folder = lib.createFolder("Dest");
  lib.addEntry(realEntry("a"), new Uint8Array([1]));
  lib.addEntry(realEntry("b"), new Uint8Array([2]));

  lib.moveEntriesToFolder(["a", "b"], folder.id);

  const entries = lib.getSnapshot().entries;
  expect(entries.find((e) => e.id === "a")?.folderId).toBe(folder.id);
  expect(entries.find((e) => e.id === "b")?.folderId).toBe(folder.id);
});

test("moveEntriesToFolder: undefined folderId moves to root", () => {
  const lib = new MediaLibrary();
  const folder = lib.createFolder("Dest");
  const entry = realEntry("a");
  entry.folderId = folder.id;
  lib.addEntry(entry, new Uint8Array([1]));

  lib.moveEntriesToFolder(["a"], undefined);

  expect(lib.getSnapshot().entries.find((e) => e.id === "a")?.folderId).toBeUndefined();
});

test("moveEntriesToFolder: throws on unknown folder, no mutation", () => {
  const lib = new MediaLibrary();
  lib.addEntry(realEntry("a"), new Uint8Array([1]));
  expect(() => lib.moveEntriesToFolder(["a"], "missing")).toThrow(/missing/);
  expect(lib.getSnapshot().entries.find((e) => e.id === "a")?.folderId).toBeUndefined();
});

test("moveFolderToFolder: reparents a folder", () => {
  const lib = new MediaLibrary();
  const a = lib.createFolder("A");
  const b = lib.createFolder("B");

  lib.moveFolderToFolder(b.id, a.id);

  expect(lib.getManifest().folders.find((f) => f.id === b.id)?.parentFolderId).toBe(a.id);
});

test("moveFolderToFolder: throws moving a folder into its own descendant", () => {
  const lib = new MediaLibrary();
  const a = lib.createFolder("A");
  const b = lib.createFolder("B", a.id);

  expect(() => lib.moveFolderToFolder(a.id, b.id)).toThrow();
});

test("moveFolderToFolder: throws moving a folder into itself", () => {
  const lib = new MediaLibrary();
  const a = lib.createFolder("A");
  expect(() => lib.moveFolderToFolder(a.id, a.id)).toThrow();
});

test("moveFolderToFolder: throws on unknown target", () => {
  const lib = new MediaLibrary();
  const a = lib.createFolder("A");
  expect(() => lib.moveFolderToFolder(a.id, "missing")).toThrow();
});

test("deleteFolders: cascades through subfolders, removes contained assets + their bytes/pending", () => {
  const lib = new MediaLibrary();
  const parent = lib.createFolder("Parent");
  const child = lib.createFolder("Child", parent.id);
  const inParent = realEntry("a");
  inParent.folderId = parent.id;
  const inChild = realEntry("b");
  inChild.folderId = child.id;
  lib.addEntry(inParent, new Uint8Array([1]));
  lib.addEntry(inChild, new Uint8Array([2]));

  const { removedAssetIds } = lib.deleteFolders([parent.id]);

  expect(new Set(removedAssetIds)).toEqual(new Set(["a", "b"]));
  const manifest = lib.getManifest();
  expect(manifest.folders).toHaveLength(0);
  expect(manifest.entries).toHaveLength(0);
  expect(lib.bytesFor(inParent)).toBeUndefined();
  expect(lib.pendingMedia().size).toBe(0);
});

test("deleteFolders: unknown folder id is a no-op (nothing removed)", () => {
  const lib = new MediaLibrary();
  const folder = lib.createFolder("Keep");
  const { removedAssetIds } = lib.deleteFolders(["missing"]);
  expect(removedAssetIds).toEqual([]);
  expect(lib.getManifest().folders).toEqual([folder]);
});

test("deleteEntries: removes entries and drops their bytes/pending", () => {
  const lib = new MediaLibrary();
  lib.addEntry(realEntry("a"), new Uint8Array([1]));
  lib.addEntry(realEntry("b"), new Uint8Array([2]));

  lib.deleteEntries(["a"]);

  const entries = lib.getSnapshot().entries;
  expect(entries.find((e) => e.id === "a")).toBeUndefined();
  expect(entries.find((e) => e.id === "b")).toBeDefined();
  expect(lib.pendingMedia().has("media/a.mp4")).toBe(false);
});

// ── importBytes / setThumbnail (M12A T3 — import_media's bytes host flow) ────

afterEach(() => {
  vi.unstubAllGlobals();
});

test("setThumbnail: sets the thumbnail returned by thumbnail(id)", () => {
  const lib = new MediaLibrary();
  lib.addEntry(realEntry("a"), new Uint8Array([1]));
  expect(lib.thumbnail("a")).toBeUndefined();
  lib.setThumbnail("a", "data:image/png;base64,xyz");
  expect(lib.thumbnail("a")).toBe("data:image/png;base64,xyz");
});

test("importBytes: unsupported mimeType rejects synchronously, no placeholder registered", async () => {
  const lib = new MediaLibrary();
  await expect(lib.importBytes(new Uint8Array([1]), "application/pdf")).rejects.toThrow(/Unsupported mimeType/);
  expect(lib.getSnapshot().entries).toHaveLength(0);
});

test("importBytes: the placeholder exists synchronously, before the returned promise is even awaited", () => {
  vi.stubGlobal("createImageBitmap", async () => ({ width: 12, height: 34, close: () => {} }));
  const lib = new MediaLibrary();

  void lib.importBytes(new Uint8Array([1, 2, 3, 4]), "image/png", "My PNG");

  const entries = lib.getSnapshot().entries;
  expect(entries).toHaveLength(1);
  expect(entries[0]!.generationStatus).toBe("downloading");
  expect(entries[0]!.name).toBe("My PNG");
  expect(entries[0]!.type).toBe("image");
  expect(entries[0]!.source.kind).toBe("project");
  expect((entries[0]!.source as { relativePath: string }).relativePath).toMatch(/^media\/imported-.+\.png$/);
});

test("importBytes: probes + finalizes in the background (status clears, dimensions land, bytes readable)", async () => {
  vi.stubGlobal("createImageBitmap", async () => ({ width: 12, height: 34, close: () => {} }));
  const lib = new MediaLibrary();

  const { assetId } = await lib.importBytes(new Uint8Array([1, 2, 3, 4]), "image/png", "My PNG");
  await flushAsync();

  const entry = lib.entry(assetId)!;
  expect(entry.generationStatus).toBeUndefined();
  expect(entry.sourceWidth).toBe(12);
  expect(entry.sourceHeight).toBe(34);
  expect(lib.bytesFor(entry)).toEqual(new Uint8Array([1, 2, 3, 4]));
});

test("importBytes: a probe failure marks the placeholder failed rather than leaving it stuck downloading", async () => {
  vi.stubGlobal("createImageBitmap", async () => {
    throw new Error("bad image data");
  });
  const lib = new MediaLibrary();

  const { assetId } = await lib.importBytes(new Uint8Array([1, 2, 3]), "image/png");
  await flushAsync();

  const entry = lib.entry(assetId)!;
  expect(entry.generationStatus).toMatch(/^failed: /);
  expect(entry.generationStatus).toMatch(/bad image data/);
});

// ── importFiles (M12A T4 — #219 async placeholder-first import) ─────────────

// jsdom's File/Blob doesn't implement arrayBuffer() — a minimal fake sidesteps that gap
// (createImageBitmap is stubbed separately and never touches this object).
function fakeFile(name: string, type: string, bytes: Uint8Array): File {
  return { name, type, arrayBuffer: async () => bytes.buffer as ArrayBuffer } as unknown as File;
}

test("importFiles: placeholders emit before any probe/finalize work runs (placeholder-first order)", () => {
  vi.stubGlobal("createImageBitmap", async () => ({ width: 1, height: 1, close: () => {} }));
  const lib = new MediaLibrary();
  const statuses: Array<Array<string | undefined>> = [];
  lib.subscribe(() => statuses.push(lib.getSnapshot().entries.map((e) => e.generationStatus)));

  const file1 = fakeFile("a.png", "image/png", new Uint8Array([1]));
  const file2 = fakeFile("b.png", "image/png", new Uint8Array([2]));
  void lib.importFiles([file1, file2]);

  // Synchronously after the call (before any microtask flush) both placeholders have already
  // emitted — placeholder-first, not "probe everything, then emit once" like the old importFiles.
  expect(statuses).toEqual([["downloading"], ["downloading", "downloading"]]);
});

test("importFiles: the placeholder exists synchronously with duration 0 and the media/<id>.<ext> path", () => {
  vi.stubGlobal("createImageBitmap", async () => ({ width: 1, height: 1, close: () => {} }));
  const lib = new MediaLibrary();
  const file = fakeFile("photo.png", "image/png", new Uint8Array([1, 2, 3]));

  void lib.importFiles([file]);

  const entries = lib.getSnapshot().entries;
  expect(entries).toHaveLength(1);
  expect(entries[0]!.generationStatus).toBe("downloading");
  expect(entries[0]!.duration).toBe(0);
  expect(entries[0]!.name).toBe("photo.png");
  expect(entries[0]!.type).toBe("image");
  expect((entries[0]!.source as { relativePath: string }).relativePath).toMatch(/^media\/.+\.png$/);
});

test("importFiles: assigns folderId to each placeholder when a folderId is passed", async () => {
  vi.stubGlobal("createImageBitmap", async () => ({ width: 1, height: 1, close: () => {} }));
  const lib = new MediaLibrary();
  const file = fakeFile("a.png", "image/png", new Uint8Array([1]));

  const added = await lib.importFiles([file], "folder-1");

  expect(added[0]!.folderId).toBe("folder-1");
  expect(lib.entry(added[0]!.id)!.folderId).toBe("folder-1");
});

test("importFiles: probes + finalizes each file in the background (status clears, dimensions land, bytes readable)", async () => {
  vi.stubGlobal("createImageBitmap", async () => ({ width: 12, height: 34, close: () => {} }));
  const lib = new MediaLibrary();
  const file = fakeFile("photo.png", "image/png", new Uint8Array([1, 2, 3, 4]));

  const added = await lib.importFiles([file]);
  await flushAsync();

  const entry = lib.entry(added[0]!.id)!;
  expect(entry.generationStatus).toBeUndefined();
  expect(entry.sourceWidth).toBe(12);
  expect(entry.sourceHeight).toBe(34);
  expect(lib.bytesFor(entry)).toEqual(new Uint8Array([1, 2, 3, 4]));
});

test("importFiles: a failing file is marked failed, the rest still finalize (failure isolation)", async () => {
  let call = 0;
  vi.stubGlobal("createImageBitmap", async () => {
    call++;
    if (call === 2) throw new Error("bad image data");
    return { width: 12, height: 34, close: () => {} };
  });
  const lib = new MediaLibrary();
  const fileOk = fakeFile("ok.png", "image/png", new Uint8Array([1, 2, 3]));
  const fileBad = fakeFile("bad.png", "image/png", new Uint8Array([4, 5, 6]));

  const added = await lib.importFiles([fileOk, fileBad]);
  await flushAsync();

  const okEntry = lib.entry(added[0]!.id)!;
  const badEntry = lib.entry(added[1]!.id)!;
  expect(okEntry.generationStatus).toBeUndefined();
  expect(okEntry.sourceWidth).toBe(12);
  expect(badEntry.generationStatus).toMatch(/^failed: /);
  expect(badEntry.generationStatus).toMatch(/bad image data/);
});
