import { describe, expect, test } from "vitest";
import {
  EditorStore,
  defaultTimeline,
  defaultTransform,
  defaultCrop,
  collectFolderCascade,
  type MediaFolder,
  type MediaManifest,
  type MediaManifestEntry,
  type Track,
  type Timeline,
} from "@palmier/core";
import {
  listFoldersTool,
  createFolderTool,
  moveToFolderTool,
  renameMediaTool,
  renameFolderTool,
  deleteMediaTool,
  deleteFolderTool,
  importMediaTool,
  IMPORT_BYTES_MAX_BASE64_LENGTH,
  type ToolContext,
} from "../src/index.js";

// ── fake library facade (mirrors @palmier/ui MediaLibrary's folder/entry ops without the
// dependency — ai must not depend on ui) ─────────────────────────────────────────────────────

class FakeLibrary {
  folders: MediaFolder[] = [];
  entries: MediaManifestEntry[] = [];
  private nextId = 1;

  listFolders(): MediaFolder[] {
    return this.folders;
  }

  createFolder(name: string, parentFolderId?: string): MediaFolder {
    if (parentFolderId !== undefined && !this.folders.some((f) => f.id === parentFolderId)) {
      throw new Error(`unknown parent folder: ${parentFolderId}`);
    }
    const folder: MediaFolder =
      parentFolderId === undefined
        ? { id: `f${this.nextId++}`, name }
        : { id: `f${this.nextId++}`, name, parentFolderId };
    this.folders.push(folder);
    return folder;
  }

  renameFolder(id: string, name: string): void {
    const f = this.folders.find((x) => x.id === id);
    if (!f) throw new Error(`unknown folder: ${id}`);
    f.name = name;
  }

  renameEntry(id: string, name: string): void {
    const e = this.entries.find((x) => x.id === id);
    if (!e) throw new Error(`unknown media entry: ${id}`);
    e.name = name;
  }

  moveEntriesToFolder(assetIds: string[], folderId: string | undefined): void {
    if (folderId !== undefined && !this.folders.some((f) => f.id === folderId)) {
      throw new Error(`unknown folder: ${folderId}`);
    }
    const set = new Set(assetIds);
    for (const e of this.entries) if (set.has(e.id)) e.folderId = folderId;
  }

  deleteFolders(ids: string[]): { removedAssetIds: string[] } {
    const { folderIds, assetIds } = collectFolderCascade(this.folders, this.entries, ids);
    this.folders = this.folders.filter((f) => !folderIds.has(f.id));
    this.entries = this.entries.filter((e) => !assetIds.has(e.id));
    return { removedAssetIds: [...assetIds] };
  }

  deleteEntries(ids: string[]): void {
    const set = new Set(ids);
    this.entries = this.entries.filter((e) => !set.has(e.id));
  }

  getManifest(): MediaManifest {
    return { version: 2, entries: this.entries, folders: this.folders };
  }
}

// ── fixtures ─────────────────────────────────────────────────────────────────

function makeEntry(id: string, folderId?: string): MediaManifestEntry {
  return {
    id,
    name: `${id}.mp4`,
    type: "video",
    source: { kind: "external", absolutePath: `/tmp/${id}.mp4` },
    duration: 2,
    ...(folderId !== undefined ? { folderId } : {}),
  };
}

function makeClip(id: string, mediaRef: string, startFrame = 0, linkGroupId?: string) {
  return {
    id,
    mediaRef,
    mediaType: "video" as const,
    sourceClipType: "video" as const,
    startFrame,
    durationFrames: 60,
    trimStartFrame: 0,
    trimEndFrame: 0,
    speed: 1,
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    fadeInInterpolation: "linear" as const,
    fadeOutInterpolation: "linear" as const,
    opacity: 1,
    transform: defaultTransform(),
    crop: defaultCrop(),
    ...(linkGroupId !== undefined ? { linkGroupId } : {}),
  };
}

function makeTrack(id: string, type: Track["type"], clips: ReturnType<typeof makeClip>[]): Track {
  return { id, type, muted: false, hidden: false, syncLocked: false, clips };
}

function makeTimeline(tracks: Track[] = []): Timeline {
  return { ...defaultTimeline(), tracks };
}

function makeCtx(lib: FakeLibrary, store: EditorStore, withLibrary = true): ToolContext {
  return {
    store,
    getManifest: () => lib.getManifest(),
    newId: () => `gen-${Math.random()}`,
    ...(withLibrary ? { library: lib } : {}),
  };
}

function textOf(result: { blocks: { kind: string; text?: string }[] }): string {
  return result.blocks.map((b) => (b.kind === "text" ? (b.text ?? "") : "")).join("");
}

// ── facade-absent (shared across all 7) ──────────────────────────────────────

describe("facade absent", () => {
  const tools = [
    { spec: listFoldersTool(), args: {} },
    { spec: createFolderTool(), args: { name: "X" } },
    { spec: moveToFolderTool(), args: { assetIds: ["a"] } },
    { spec: renameMediaTool(), args: { mediaRef: "a", name: "x" } },
    { spec: renameFolderTool(), args: { folderId: "f1", name: "x" } },
    { spec: deleteMediaTool(), args: { assetIds: ["a"] } },
    { spec: deleteFolderTool(), args: { folderIds: ["f1"] } },
  ];
  for (const { spec, args } of tools) {
    test(`${spec.name}: errors cleanly when ctx.library is absent`, async () => {
      const store = new EditorStore(makeTimeline());
      const ctx = makeCtx(new FakeLibrary(), store, false);
      const result = await spec.run(args, ctx);
      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatch(/media library is not available/);
    });
  }
});

// ── list_folders ──────────────────────────────────────────────────────────────

describe("list_folders", () => {
  test("returns folders as {id, name, parentFolderId?}", async () => {
    const lib = new FakeLibrary();
    const a = lib.createFolder("A");
    lib.createFolder("B", a.id);
    const ctx = makeCtx(lib, new EditorStore(makeTimeline()));
    const result = await listFoldersTool().run({}, ctx);
    expect(result.isError).toBe(false);
    const parsed = JSON.parse(textOf(result)) as { folders: { id: string; name: string; parentFolderId?: string }[] };
    expect(parsed.folders).toHaveLength(2);
    expect(parsed.folders.find((f) => f.name === "B")?.parentFolderId).toBe(a.id);
    expect(parsed.folders.find((f) => f.name === "A")?.parentFolderId).toBeUndefined();
  });
});

// ── create_folder ─────────────────────────────────────────────────────────────

describe("create_folder", () => {
  test("single form: creates folder at root, returns folder object", async () => {
    const lib = new FakeLibrary();
    const ctx = makeCtx(lib, new EditorStore(makeTimeline()));
    const result = await createFolderTool().run({ name: "B-roll" }, ctx);
    expect(result.isError).toBe(false);
    const parsed = JSON.parse(textOf(result)) as { id: string; name: string };
    expect(parsed.name).toBe("B-roll");
    expect(lib.folders).toHaveLength(1);
  });

  test("single form: nests under parentFolderId", async () => {
    const lib = new FakeLibrary();
    const parent = lib.createFolder("Parent");
    const ctx = makeCtx(lib, new EditorStore(makeTimeline()));
    const result = await createFolderTool().run({ name: "Child", parentFolderId: parent.id }, ctx);
    expect(result.isError).toBe(false);
    expect(lib.folders.find((f) => f.name === "Child")?.parentFolderId).toBe(parent.id);
  });

  test("batch entries[] form: creates multiple folders, returns { folders }", async () => {
    const lib = new FakeLibrary();
    const ctx = makeCtx(lib, new EditorStore(makeTimeline()));
    const result = await createFolderTool().run({ entries: [{ name: "A" }, { name: "B" }] }, ctx);
    expect(result.isError).toBe(false);
    const parsed = JSON.parse(textOf(result)) as { folders: { name: string }[] };
    expect(parsed.folders.map((f) => f.name).sort()).toEqual(["A", "B"]);
    expect(lib.folders).toHaveLength(2);
  });

  test("both forms provided: rejected, nothing created", async () => {
    const lib = new FakeLibrary();
    const ctx = makeCtx(lib, new EditorStore(makeTimeline()));
    const result = await createFolderTool().run({ name: "X", entries: [{ name: "Y" }] }, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/not both/);
    expect(lib.folders).toHaveLength(0);
  });

  test("neither form provided: rejected", async () => {
    const lib = new FakeLibrary();
    const ctx = makeCtx(lib, new EditorStore(makeTimeline()));
    const result = await createFolderTool().run({}, ctx);
    expect(result.isError).toBe(true);
  });

  test("unknown parentFolderId (single form): rejected, nothing created", async () => {
    const lib = new FakeLibrary();
    const ctx = makeCtx(lib, new EditorStore(makeTimeline()));
    const result = await createFolderTool().run({ name: "X", parentFolderId: "missing" }, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/parentFolderId not found: missing/);
    expect(lib.folders).toHaveLength(0);
  });

  test("unknown parentFolderId (batch form): all-or-nothing", async () => {
    const lib = new FakeLibrary();
    const ctx = makeCtx(lib, new EditorStore(makeTimeline()));
    const result = await createFolderTool().run({ entries: [{ name: "A" }, { name: "B", parentFolderId: "missing" }] }, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/entries\[1\]: parentFolderId not found: missing/);
    expect(lib.folders).toHaveLength(0);
  });

  test("empty entries[] array: rejected", async () => {
    const lib = new FakeLibrary();
    const ctx = makeCtx(lib, new EditorStore(makeTimeline()));
    const result = await createFolderTool().run({ entries: [] }, ctx);
    expect(result.isError).toBe(true);
  });
});

// ── move_to_folder ────────────────────────────────────────────────────────────

describe("move_to_folder", () => {
  test("single form: moves assets to a folder", async () => {
    const lib = new FakeLibrary();
    const folder = lib.createFolder("Dest");
    lib.entries.push(makeEntry("a"), makeEntry("b"));
    const ctx = makeCtx(lib, new EditorStore(makeTimeline()));
    const result = await moveToFolderTool().run({ assetIds: ["a", "b"], folderId: folder.id }, ctx);
    expect(result.isError).toBe(false);
    expect(lib.entries.find((e) => e.id === "a")?.folderId).toBe(folder.id);
    expect(lib.entries.find((e) => e.id === "b")?.folderId).toBe(folder.id);
    expect(textOf(result)).toMatch(/to folder/);
  });

  test("single form: omitting folderId moves to root", async () => {
    const lib = new FakeLibrary();
    const folder = lib.createFolder("Dest");
    lib.entries.push(makeEntry("a", folder.id));
    const ctx = makeCtx(lib, new EditorStore(makeTimeline()));
    const result = await moveToFolderTool().run({ assetIds: ["a"] }, ctx);
    expect(result.isError).toBe(false);
    expect(lib.entries.find((e) => e.id === "a")?.folderId).toBeUndefined();
    expect(textOf(result)).toMatch(/to root/);
  });

  test("batch entries[] form: moves to different folders in one call", async () => {
    const lib = new FakeLibrary();
    const f1 = lib.createFolder("F1");
    const f2 = lib.createFolder("F2");
    lib.entries.push(makeEntry("a"), makeEntry("b"));
    const ctx = makeCtx(lib, new EditorStore(makeTimeline()));
    const result = await moveToFolderTool().run(
      { entries: [{ assetIds: ["a"], folderId: f1.id }, { assetIds: ["b"], folderId: f2.id }] },
      ctx,
    );
    expect(result.isError).toBe(false);
    expect(lib.entries.find((e) => e.id === "a")?.folderId).toBe(f1.id);
    expect(lib.entries.find((e) => e.id === "b")?.folderId).toBe(f2.id);
  });

  test("both forms provided: rejected", async () => {
    const lib = new FakeLibrary();
    lib.entries.push(makeEntry("a"));
    const ctx = makeCtx(lib, new EditorStore(makeTimeline()));
    const result = await moveToFolderTool().run({ assetIds: ["a"], entries: [{ assetIds: ["a"] }] }, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/not both/);
  });

  test("neither form (empty assetIds): rejected", async () => {
    const lib = new FakeLibrary();
    const ctx = makeCtx(lib, new EditorStore(makeTimeline()));
    const result = await moveToFolderTool().run({}, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/assetIds is required/);
  });

  test("unknown assetId: rejected, no mutation", async () => {
    const lib = new FakeLibrary();
    lib.entries.push(makeEntry("a"));
    const ctx = makeCtx(lib, new EditorStore(makeTimeline()));
    const result = await moveToFolderTool().run({ assetIds: ["missing"] }, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/media asset not found: missing/);
  });

  test("unknown folderId: rejected", async () => {
    const lib = new FakeLibrary();
    lib.entries.push(makeEntry("a"));
    const ctx = makeCtx(lib, new EditorStore(makeTimeline()));
    const result = await moveToFolderTool().run({ assetIds: ["a"], folderId: "missing" }, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/folderId not found: missing/);
  });
});

// ── rename_media ──────────────────────────────────────────────────────────────

describe("rename_media", () => {
  test("single form: renames an asset", async () => {
    const lib = new FakeLibrary();
    lib.entries.push(makeEntry("a"));
    const ctx = makeCtx(lib, new EditorStore(makeTimeline()));
    const result = await renameMediaTool().run({ mediaRef: "a", name: "New Name" }, ctx);
    expect(result.isError).toBe(false);
    expect(lib.entries.find((e) => e.id === "a")?.name).toBe("New Name");
  });

  test("batch entries[] form: renames multiple assets", async () => {
    const lib = new FakeLibrary();
    lib.entries.push(makeEntry("a"), makeEntry("b"));
    const ctx = makeCtx(lib, new EditorStore(makeTimeline()));
    const result = await renameMediaTool().run(
      { entries: [{ mediaRef: "a", name: "A2" }, { mediaRef: "b", name: "B2" }] },
      ctx,
    );
    expect(result.isError).toBe(false);
    expect(lib.entries.find((e) => e.id === "a")?.name).toBe("A2");
    expect(lib.entries.find((e) => e.id === "b")?.name).toBe("B2");
  });

  test("both forms provided: rejected", async () => {
    const lib = new FakeLibrary();
    lib.entries.push(makeEntry("a"));
    const ctx = makeCtx(lib, new EditorStore(makeTimeline()));
    const result = await renameMediaTool().run({ mediaRef: "a", name: "x", entries: [{ mediaRef: "a", name: "y" }] }, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/not both/);
  });

  test("neither form provided: rejected", async () => {
    const lib = new FakeLibrary();
    const ctx = makeCtx(lib, new EditorStore(makeTimeline()));
    const result = await renameMediaTool().run({}, ctx);
    expect(result.isError).toBe(true);
  });

  test("unknown mediaRef: rejected", async () => {
    const lib = new FakeLibrary();
    const ctx = makeCtx(lib, new EditorStore(makeTimeline()));
    const result = await renameMediaTool().run({ mediaRef: "missing", name: "x" }, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/Media asset not found: missing/);
  });
});

// ── rename_folder ─────────────────────────────────────────────────────────────

describe("rename_folder", () => {
  test("single form: renames a folder", async () => {
    const lib = new FakeLibrary();
    const folder = lib.createFolder("Old");
    const ctx = makeCtx(lib, new EditorStore(makeTimeline()));
    const result = await renameFolderTool().run({ folderId: folder.id, name: "New" }, ctx);
    expect(result.isError).toBe(false);
    expect(lib.folders.find((f) => f.id === folder.id)?.name).toBe("New");
  });

  test("batch entries[] form: renames multiple folders", async () => {
    const lib = new FakeLibrary();
    const a = lib.createFolder("A");
    const b = lib.createFolder("B");
    const ctx = makeCtx(lib, new EditorStore(makeTimeline()));
    const result = await renameFolderTool().run(
      { entries: [{ folderId: a.id, name: "A2" }, { folderId: b.id, name: "B2" }] },
      ctx,
    );
    expect(result.isError).toBe(false);
    expect(lib.folders.find((f) => f.id === a.id)?.name).toBe("A2");
    expect(lib.folders.find((f) => f.id === b.id)?.name).toBe("B2");
  });

  test("both forms provided: rejected", async () => {
    const lib = new FakeLibrary();
    const folder = lib.createFolder("A");
    const ctx = makeCtx(lib, new EditorStore(makeTimeline()));
    const result = await renameFolderTool().run(
      { folderId: folder.id, name: "x", entries: [{ folderId: folder.id, name: "y" }] },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/not both/);
  });

  test("unknown folderId: rejected", async () => {
    const lib = new FakeLibrary();
    const ctx = makeCtx(lib, new EditorStore(makeTimeline()));
    const result = await renameFolderTool().run({ folderId: "missing", name: "x" }, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/folderId not found: missing/);
  });
});

// ── delete_media ──────────────────────────────────────────────────────────────

describe("delete_media", () => {
  test("happy path: deletes asset, no referencing clips -> no undo step, permanence note present", async () => {
    const lib = new FakeLibrary();
    lib.entries.push(makeEntry("a"));
    const store = new EditorStore(makeTimeline());
    const ctx = makeCtx(lib, store);
    const result = await deleteMediaTool().run({ assetIds: ["a"] }, ctx);
    expect(result.isError).toBe(false);
    expect(lib.entries).toHaveLength(0);
    expect(store.canUndo()).toBe(false);
    const parsed = JSON.parse(textOf(result)) as { note: string; removedAssetIds: string[]; removedClipIds: string[] };
    expect(parsed.note).toMatch(/permanent/);
    expect(parsed.removedAssetIds).toEqual(["a"]);
    expect(parsed.removedClipIds).toEqual([]);
  });

  test("cascade: removes referencing clips (incl. a linked partner on another track) as ONE undo step", async () => {
    const lib = new FakeLibrary();
    lib.entries.push(makeEntry("a"));
    const store = new EditorStore(
      makeTimeline([
        makeTrack("v", "video", [makeClip("c1", "a", 0, "link1")]),
        makeTrack("au", "audio", [makeClip("c2", "a", 0, "link1")]),
      ]),
    );
    const ctx = makeCtx(lib, store);
    const result = await deleteMediaTool().run({ assetIds: ["a"] }, ctx);
    expect(result.isError).toBe(false);

    const tl = store.getSnapshot().timeline;
    expect(tl.tracks.flatMap((t) => t.clips)).toHaveLength(0);
    expect(store.canUndo()).toBe(true);

    store.undo();
    const restored = store.getSnapshot().timeline;
    expect(restored.tracks.flatMap((t) => t.clips).map((c) => c.id).sort()).toEqual(["c1", "c2"]);
    expect(store.canUndo()).toBe(false);

    const parsed = JSON.parse(textOf(result)) as { removedClipIds: string[] };
    expect(parsed.removedClipIds.sort()).toEqual(["c1", "c2"]);
  });

  test("empty assetIds: rejected", async () => {
    const lib = new FakeLibrary();
    const ctx = makeCtx(lib, new EditorStore(makeTimeline()));
    const result = await deleteMediaTool().run({}, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/assetIds is required/);
  });

  test("unknown assetId: rejected, no mutation", async () => {
    const lib = new FakeLibrary();
    lib.entries.push(makeEntry("a"));
    const store = new EditorStore(makeTimeline());
    const ctx = makeCtx(lib, store);
    const result = await deleteMediaTool().run({ assetIds: ["a", "missing"] }, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/Media asset not found: missing/);
    expect(lib.entries).toHaveLength(1);
    expect(store.canUndo()).toBe(false);
  });
});

// ── delete_folder ─────────────────────────────────────────────────────────────

describe("delete_folder", () => {
  test("happy path: cascades through subfolders and contained assets, reports counts", async () => {
    const lib = new FakeLibrary();
    const parent = lib.createFolder("Parent");
    const child = lib.createFolder("Child", parent.id);
    lib.entries.push(makeEntry("a", parent.id), makeEntry("b", child.id));
    const store = new EditorStore(makeTimeline());
    const ctx = makeCtx(lib, store);

    const result = await deleteFolderTool().run({ folderIds: [parent.id] }, ctx);
    expect(result.isError).toBe(false);
    expect(lib.folders).toHaveLength(0);
    expect(lib.entries).toHaveLength(0);

    const parsed = JSON.parse(textOf(result)) as {
      folderCount: number; assetCount: number; clipCount: number; note: string; removedAssetIds: string[];
    };
    expect(parsed.folderCount).toBe(2);
    expect(parsed.assetCount).toBe(2);
    expect(parsed.clipCount).toBe(0);
    expect(parsed.note).toMatch(/permanent/);
    expect(new Set(parsed.removedAssetIds)).toEqual(new Set(["a", "b"]));
  });

  test("cascade: removes clips referencing any cascaded asset as ONE undo step", async () => {
    const lib = new FakeLibrary();
    const folder = lib.createFolder("F");
    lib.entries.push(makeEntry("a", folder.id));
    const store = new EditorStore(makeTimeline([makeTrack("v", "video", [makeClip("c1", "a")])]));
    const ctx = makeCtx(lib, store);

    const result = await deleteFolderTool().run({ folderIds: [folder.id] }, ctx);
    expect(result.isError).toBe(false);
    expect(store.getSnapshot().timeline.tracks[0]!.clips).toHaveLength(0);
    expect(store.canUndo()).toBe(true);
    store.undo();
    expect(store.getSnapshot().timeline.tracks[0]!.clips).toHaveLength(1);
  });

  test("empty folderIds: rejected", async () => {
    const lib = new FakeLibrary();
    const ctx = makeCtx(lib, new EditorStore(makeTimeline()));
    const result = await deleteFolderTool().run({}, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/folderIds is required/);
  });

  test("unknown folderId: rejected, no mutation", async () => {
    const lib = new FakeLibrary();
    const folder = lib.createFolder("Keep");
    const ctx = makeCtx(lib, new EditorStore(makeTimeline()));
    const result = await deleteFolderTool().run({ folderIds: ["missing"] }, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/folderId not found: missing/);
    expect(lib.folders).toEqual([folder]);
  });
});

// ── import_media ──────────────────────────────────────────────────────────────

function b64(bytes: number[]): string {
  return Buffer.from(bytes).toString("base64");
}

class FakeMediaImport {
  calls: { kind: string; args: unknown[] }[] = [];
  fromBytesResult: { assetId: string } | Error = { assetId: "asset-bytes" };
  fromUrlResult: { assetId: string } | Error = { assetId: "asset-url" };
  fromPathResult: { assetIds: string[] } | Error = { assetIds: ["asset-path-1"] };
  hasFromPath = true;

  async fromBytes(bytes: Uint8Array, mimeType: string, name?: string, folderId?: string): Promise<{ assetId: string }> {
    this.calls.push({ kind: "fromBytes", args: [bytes, mimeType, name, folderId] });
    if (this.fromBytesResult instanceof Error) throw this.fromBytesResult;
    return this.fromBytesResult;
  }

  async fromUrl(url: string, name?: string, folderId?: string, mimeType?: string): Promise<{ assetId: string }> {
    this.calls.push({ kind: "fromUrl", args: [url, name, folderId, mimeType] });
    if (this.fromUrlResult instanceof Error) throw this.fromUrlResult;
    return this.fromUrlResult;
  }

  get fromPath(): ((absPath: string, folderId?: string) => Promise<{ assetIds: string[] }>) | undefined {
    if (!this.hasFromPath) return undefined;
    return async (absPath: string, folderId?: string) => {
      this.calls.push({ kind: "fromPath", args: [absPath, folderId] });
      if (this.fromPathResult instanceof Error) throw this.fromPathResult;
      return this.fromPathResult;
    };
  }
}

function makeImportCtx(mediaImport: FakeMediaImport | undefined, library?: FakeLibrary): ToolContext {
  return {
    store: new EditorStore(makeTimeline()),
    getManifest: () => (library ?? new FakeLibrary()).getManifest(),
    newId: () => `gen-${Math.random()}`,
    ...(library ? { library } : {}),
    ...(mediaImport ? { mediaImport } : {}),
  };
}

describe("import_media — facade absent", () => {
  test("errors cleanly when ctx.mediaImport is absent", async () => {
    const ctx = makeImportCtx(undefined);
    const result = await importMediaTool().run({ source: { bytes: b64([1, 2, 3]), mimeType: "image/png" } }, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/media import is not available/);
  });
});

describe("import_media — source validation", () => {
  test("missing source: rejected", async () => {
    const ctx = makeImportCtx(new FakeMediaImport());
    const result = await importMediaTool().run({}, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/Missing required 'source'/);
  });

  test("neither url/path/bytes set: rejected (got 0)", async () => {
    const ctx = makeImportCtx(new FakeMediaImport());
    const result = await importMediaTool().run({ source: {} }, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/exactly one.*got 0/);
  });

  test("both url and bytes set: rejected (got 2)", async () => {
    const ctx = makeImportCtx(new FakeMediaImport());
    const result = await importMediaTool().run(
      { source: { url: "https://example.com/a.mp4", bytes: b64([1]), mimeType: "video/mp4" } },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/exactly one.*got 2/);
  });

  test("unknown folderId (ctx.library present): rejected, facade not called", async () => {
    const mediaImport = new FakeMediaImport();
    const lib = new FakeLibrary();
    const ctx = makeImportCtx(mediaImport, lib);
    const result = await importMediaTool().run(
      { source: { bytes: b64([1, 2, 3]), mimeType: "image/png" }, folderId: "missing" },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/folderId not found: missing/);
    expect(mediaImport.calls).toHaveLength(0);
  });
});

describe("import_media — bytes", () => {
  test("mimeType required when bytes set", async () => {
    const ctx = makeImportCtx(new FakeMediaImport());
    const result = await importMediaTool().run({ source: { bytes: b64([1, 2, 3]) } }, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/mimeType is required/);
  });

  test("base64 over the cap: rejected before decoding", async () => {
    const ctx = makeImportCtx(new FakeMediaImport());
    const huge = "A".repeat(IMPORT_BYTES_MAX_BASE64_LENGTH + 1);
    const result = await importMediaTool().run({ source: { bytes: huge, mimeType: "image/png" } }, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/too large/);
  });

  test("unsupported mimeType: rejected", async () => {
    const ctx = makeImportCtx(new FakeMediaImport());
    const result = await importMediaTool().run({ source: { bytes: b64([1]), mimeType: "application/pdf" } }, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/Unsupported mimeType 'application\/pdf'/);
  });

  test("json/Lottie mimeType: rejected with the Lottie-deviation message", async () => {
    const ctx = makeImportCtx(new FakeMediaImport());
    const result = await importMediaTool().run({ source: { bytes: b64([1]), mimeType: "application/json" } }, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/Lottie.*not supported/);
  });

  test("invalid base64: rejected", async () => {
    const ctx = makeImportCtx(new FakeMediaImport());
    const result = await importMediaTool().run({ source: { bytes: "not-base64!!!", mimeType: "image/png" } }, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/not valid non-empty base64/);
  });

  test("happy path: decodes bytes, calls facade.fromBytes, returns placeholder id", async () => {
    const mediaImport = new FakeMediaImport();
    const ctx = makeImportCtx(mediaImport);
    const result = await importMediaTool().run(
      { source: { bytes: b64([1, 2, 3, 4]), mimeType: "image/png" }, name: "My PNG", folderId: "f1" },
      ctx,
    );
    expect(result.isError).toBe(false);
    expect(mediaImport.calls).toEqual([
      { kind: "fromBytes", args: [new Uint8Array([1, 2, 3, 4]), "image/png", "My PNG", "f1"] },
    ]);
    expect(textOf(result)).toMatch(/asset-bytes/);
  });

  test("facade throws: surfaced as an error result", async () => {
    const mediaImport = new FakeMediaImport();
    mediaImport.fromBytesResult = new Error("disk full");
    const ctx = makeImportCtx(mediaImport);
    const result = await importMediaTool().run({ source: { bytes: b64([1, 2]), mimeType: "image/png" } }, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/disk full/);
  });

  test("placeholder-then-finalize ordering: the tool resolves once the placeholder is registered, before finalize", async () => {
    const events: string[] = [];
    const mediaImport = new FakeMediaImport();
    let finalizeDone!: () => void;
    const finalizePromise = new Promise<void>((resolve) => { finalizeDone = resolve; });
    mediaImport.fromBytes = async (bytes, mimeType, name, folderId) => {
      events.push("placeholder");
      // A macrotask (not a microtask): guarantees "finalize" lands strictly after the tool's
      // `await facade.fromBytes(...)` continuation, which is itself microtask-scheduled.
      setTimeout(() => {
        events.push("finalize");
        finalizeDone();
      }, 0);
      void bytes; void mimeType; void name; void folderId;
      return { assetId: "asset-bytes" };
    };
    const ctx = makeImportCtx(mediaImport);
    const result = await importMediaTool().run({ source: { bytes: b64([9]), mimeType: "image/png" } }, ctx);
    expect(result.isError).toBe(false);
    expect(events).toEqual(["placeholder"]); // finalize hasn't happened yet when the tool resolves
    await finalizePromise;
    expect(events).toEqual(["placeholder", "finalize"]);
  });
});

describe("import_media — url", () => {
  test("invalid URL: rejected", async () => {
    const ctx = makeImportCtx(new FakeMediaImport());
    const result = await importMediaTool().run({ source: { url: "not a url" } }, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/not a valid URL/);
  });

  test("http (not https): rejected", async () => {
    const ctx = makeImportCtx(new FakeMediaImport());
    const result = await importMediaTool().run({ source: { url: "http://example.com/a.mp4" } }, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/must use https/);
  });

  test("embedded credentials: rejected", async () => {
    const ctx = makeImportCtx(new FakeMediaImport());
    const result = await importMediaTool().run({ source: { url: "https://user:pass@example.com/a.mp4" } }, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/must not embed credentials/);
  });

  test("no extension and no mimeType override: rejected", async () => {
    const ctx = makeImportCtx(new FakeMediaImport());
    const result = await importMediaTool().run({ source: { url: "https://example.com/asset" } }, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/Cannot infer media type/);
  });

  test("json extension: rejected with the Lottie-deviation message", async () => {
    const ctx = makeImportCtx(new FakeMediaImport());
    const result = await importMediaTool().run({ source: { url: "https://example.com/a.json" } }, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/Lottie.*not supported/);
  });

  test("happy path (extension inferred from the URL): calls facade.fromUrl", async () => {
    const mediaImport = new FakeMediaImport();
    const ctx = makeImportCtx(mediaImport);
    const result = await importMediaTool().run({ source: { url: "https://example.com/clip.mp4" }, name: "Clip" }, ctx);
    expect(result.isError).toBe(false);
    expect(mediaImport.calls).toEqual([{ kind: "fromUrl", args: ["https://example.com/clip.mp4", "Clip", undefined, undefined] }]);
    expect(textOf(result)).toMatch(/asset-url/);
  });

  test("mimeType override lets an extensionless signed URL through", async () => {
    const mediaImport = new FakeMediaImport();
    const ctx = makeImportCtx(mediaImport);
    const result = await importMediaTool().run(
      { source: { url: "https://example.com/signed?token=abc", mimeType: "video/mp4" } },
      ctx,
    );
    expect(result.isError).toBe(false);
    expect(mediaImport.calls).toEqual([
      { kind: "fromUrl", args: ["https://example.com/signed?token=abc", undefined, undefined, "video/mp4"] },
    ]);
  });
});

describe("import_media — path", () => {
  test("no fromPath on the facade (web host): rejected", async () => {
    const mediaImport = new FakeMediaImport();
    mediaImport.hasFromPath = false;
    const ctx = makeImportCtx(mediaImport);
    const result = await importMediaTool().run({ source: { path: "/Users/x/clip.mp4" } }, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/not available on web/);
  });

  test("happy path: calls facade.fromPath, reports the placeholder ids", async () => {
    const mediaImport = new FakeMediaImport();
    mediaImport.fromPathResult = { assetIds: ["a1", "a2", "a3"] };
    const ctx = makeImportCtx(mediaImport);
    const result = await importMediaTool().run({ source: { path: "/Users/x/Movies" }, folderId: undefined }, ctx);
    expect(result.isError).toBe(false);
    expect(mediaImport.calls).toEqual([{ kind: "fromPath", args: ["/Users/x/Movies", undefined] }]);
    expect(textOf(result)).toMatch(/3 placeholder asset/);
    expect(textOf(result)).toMatch(/a1, a2, a3/);
  });

  test("no supported media found: rejected", async () => {
    const mediaImport = new FakeMediaImport();
    mediaImport.fromPathResult = { assetIds: [] };
    const ctx = makeImportCtx(mediaImport);
    const result = await importMediaTool().run({ source: { path: "/Users/x/empty" } }, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/No supported media found/);
  });

  test("facade throws (e.g. path escapes the project dir): surfaced as an error result", async () => {
    const mediaImport = new FakeMediaImport();
    mediaImport.fromPathResult = new Error("path not found: /nope");
    const ctx = makeImportCtx(mediaImport);
    const result = await importMediaTool().run({ source: { path: "/nope" } }, ctx);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/path not found: \/nope/);
  });
});
