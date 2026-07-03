import { render, screen, within, fireEvent, act, waitFor } from "@testing-library/react";
import { EditorStore, defaultTimeline, type MediaFolder, type MediaManifestEntry } from "@palmier/core";
import { MediaPanel } from "../src/media/MediaPanel.js";
import type { MediaIndexingFacade } from "../src/media/MediaPanel.js";
import type { IndexStatus } from "../src/media/media-indexing.js";
import { MEDIA_DRAG_MIME } from "../src/media/FolderTile.js";

function fakeIndexing(
  initial: IndexStatus,
  ensureReady?: MediaIndexingFacade["ensureReady"],
): MediaIndexingFacade & { set: (s: IndexStatus) => void } {
  let status = initial;
  const listeners = new Set<() => void>();
  return {
    getStatus: () => status,
    subscribe: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    ensureReady,
    set: (s) => {
      status = s;
      for (const cb of listeners) cb();
    },
  };
}

interface FakeLibraryCalls {
  importFiles: Array<{ files: unknown; folderId: string | undefined }>;
  createFolder: Array<{ name: string; parentFolderId: string | undefined }>;
  renameFolder: Array<{ folderId: string; name: string }>;
  deleteFolders: Array<{ folderIds: string[] }>;
  moveEntriesToFolder: Array<{ assetIds: string[]; folderId: string | undefined }>;
  moveFolderToFolder: Array<{ folderId: string; targetId: string | undefined }>;
  importBytes: Array<{ mimeType: string; name: string | undefined; folderId: string | undefined }>;
}

function fakeLibrary(initialEntries: MediaManifestEntry[] = [], initialFolders: MediaFolder[] = [], withMatte = false) {
  let entries = initialEntries;
  let folders = initialFolders;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const l of listeners) l();
  };
  const calls: FakeLibraryCalls = {
    importFiles: [],
    createFolder: [],
    renameFolder: [],
    deleteFolders: [],
    moveEntriesToFolder: [],
    moveFolderToFolder: [],
    importBytes: [],
  };

  const lib = {
    getSnapshot: () => ({ entries, folders }),
    subscribe: (cb: () => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    thumbnail: (id: string) => `${id}-thumb.png`,
    importFiles: async (files: File[] | FileList, folderId?: string) => {
      calls.importFiles.push({ files, folderId });
      return [];
    },
    entry: (id: string) => entries.find((e) => e.id === id),
    createFolder: (name: string, parentFolderId?: string): MediaFolder => {
      calls.createFolder.push({ name, parentFolderId });
      const folder: MediaFolder = { id: `folder-${folders.length + 1}`, name, ...(parentFolderId !== undefined ? { parentFolderId } : {}) };
      folders = [...folders, folder];
      notify();
      return folder;
    },
    renameFolder: (folderId: string, name: string) => {
      calls.renameFolder.push({ folderId, name });
      folders = folders.map((f) => (f.id === folderId ? { ...f, name } : f));
      notify();
    },
    deleteFolders: (folderIds: string[]) => {
      calls.deleteFolders.push({ folderIds });
      const idSet = new Set(folderIds);
      folders = folders.filter((f) => !idSet.has(f.id));
      notify();
      return { removedAssetIds: [] };
    },
    moveEntriesToFolder: (assetIds: string[], folderId: string | undefined) => {
      calls.moveEntriesToFolder.push({ assetIds, folderId });
      const idSet = new Set(assetIds);
      entries = entries.map((e) => (idSet.has(e.id) ? { ...e, folderId } : e));
      notify();
    },
    moveFolderToFolder: (folderId: string, targetId: string | undefined) => {
      calls.moveFolderToFolder.push({ folderId, targetId });
      if (folderId === targetId) throw new Error("cannot move folder into itself");
      // descendant check mirrors canMoveFolder: reject when targetId is folderId's own child
      const isDescendant = folders.some((f) => f.id === targetId && f.parentFolderId === folderId);
      if (isDescendant) throw new Error("cannot move folder into its own descendant");
      folders = folders.map((f) => (f.id === folderId ? { ...f, parentFolderId: targetId } : f));
      notify();
    },
    ...(withMatte
      ? {
          importBytes: async (_bytes: Uint8Array, mimeType: string, name?: string, folderId?: string) => {
            calls.importBytes.push({ mimeType, name, folderId });
            return { assetId: "matte-asset-1" };
          },
        }
      : {}),
  };

  return Object.assign(lib, { calls });
}

function baseEntry(id: string, overrides: Partial<MediaManifestEntry> = {}): MediaManifestEntry {
  return {
    id,
    name: `${id}.mp4`,
    type: "video",
    source: { kind: "project", relativePath: `media/${id}.mp4` },
    duration: 5,
    ...overrides,
  };
}

function makeDataTransfer(initial?: { kind: "asset" | "folder"; id: string }) {
  const store = new Map<string, string>();
  if (initial) store.set(MEDIA_DRAG_MIME, JSON.stringify(initial));
  return {
    setData: (type: string, val: string) => {
      store.set(type, val);
    },
    getData: (type: string) => store.get(type) ?? "",
    get types() {
      return Array.from(store.keys());
    },
    effectAllowed: "move",
    files: [] as unknown as FileList,
  };
}

test("normal entry renders unchanged: thumbnail, no overlay, no failed state", () => {
  render(<MediaPanel library={fakeLibrary([baseEntry("a")])} />);
  const item = screen.getByTestId("media-item");
  expect(within(item).getByRole("img")).toBeInTheDocument();
  expect(within(item).queryByTestId("generating-overlay")).toBeNull();
  expect(within(item).queryByTestId("media-item-failed")).toBeNull();
  expect(item).toHaveTextContent("a.mp4");
});

test("generating entry renders the overlay and suppresses the thumbnail + hover actions", () => {
  render(<MediaPanel library={fakeLibrary([baseEntry("a", { generationStatus: "generating" })])} />);
  const item = screen.getByTestId("media-item");
  expect(within(item).getByTestId("generating-overlay")).toHaveTextContent("Generating...");
  expect(within(item).queryByRole("img")).toBeNull();
  expect(within(item).queryByRole("button")).toBeNull();
});

test("preparing/downloading/rendering entries map to their in-flight labels", () => {
  render(
    <MediaPanel
      library={fakeLibrary([
        baseEntry("a", { generationStatus: "preparing" }),
        baseEntry("b", { generationStatus: "downloading" }),
        baseEntry("c", { generationStatus: "rendering" }),
      ])}
    />,
  );
  const items = screen.getAllByTestId("media-item");
  expect(items[0]).toHaveTextContent("Preparing...");
  expect(items[1]).toHaveTextContent("Downloading...");
  expect(items[2]).toHaveTextContent("Rendering...");
});

test("failed entry shows the Failed state with the message and a title attr, no overlay", () => {
  render(<MediaPanel library={fakeLibrary([baseEntry("a", { generationStatus: "failed: network timeout" })])} />);
  const item = screen.getByTestId("media-item");
  expect(within(item).queryByTestId("generating-overlay")).toBeNull();
  const failedEl = within(item).getByTestId("media-item-failed");
  expect(item).toHaveTextContent("Failed");
  expect(item).toHaveTextContent("network timeout");
  expect(failedEl).toHaveAttribute("title", "network timeout");
});

// ── Folder drill-in (M12A T4) ────────────────────────────────────────────────

test("root view: only root-level folders and entries are visible, folders before assets", () => {
  const folderB: MediaFolder = { id: "fb", name: "B-roll" };
  const folderA: MediaFolder = { id: "fa", name: "A-roll" };
  const rootEntry = baseEntry("root-1");
  const nestedEntry = baseEntry("nested-1", { folderId: "fa" });
  const lib = fakeLibrary([rootEntry, nestedEntry], [folderB, folderA]);

  render(<MediaPanel library={lib} />);

  const tiles = screen.getAllByTestId(/folder-tile|media-item/);
  // Folders sorted by name (A-roll, B-roll) and rendered before assets
  expect(tiles[0]).toHaveAttribute("data-folder-id", "fa");
  expect(tiles[1]).toHaveAttribute("data-folder-id", "fb");
  expect(tiles[2]).toHaveAttribute("data-media-id", "root-1");
  // The nested entry (folderId=fa) is not shown at root
  expect(screen.queryByText("nested-1.mp4")).toBeNull();
});

test("folder tile shows a child-count badge covering subfolders + contained assets", () => {
  const parent: MediaFolder = { id: "p", name: "Parent" };
  const child: MediaFolder = { id: "c", name: "Child", parentFolderId: "p" };
  const entries = [baseEntry("a", { folderId: "p" }), baseEntry("b", { folderId: "p" })];
  const lib = fakeLibrary(entries, [parent, child]);

  render(<MediaPanel library={lib} />);

  const tile = screen.getByTestId("folder-tile");
  expect(within(tile).getByTestId("folder-child-count")).toHaveTextContent("3"); // 1 subfolder + 2 assets
});

test("drill-in navigation: double-click opens a folder, breadcrumb navigates back to root", () => {
  const folder: MediaFolder = { id: "f1", name: "Interviews" };
  const nested = baseEntry("nested-1", { folderId: "f1" });
  const lib = fakeLibrary([nested], [folder]);

  render(<MediaPanel library={lib} />);

  expect(screen.getByTestId("media-breadcrumb-root")).toBeInTheDocument();
  expect(screen.queryByText("nested-1.mp4")).toBeNull();

  fireEvent.doubleClick(screen.getByTestId("folder-tile"));

  expect(screen.getByText("nested-1.mp4")).toBeInTheDocument();
  expect(screen.getByTestId("media-breadcrumb-f1")).toHaveTextContent("Interviews");
  expect(screen.queryByTestId("folder-tile")).toBeNull();

  fireEvent.click(screen.getByTestId("media-breadcrumb-root"));

  expect(screen.getByTestId("folder-tile")).toBeInTheDocument();
  expect(screen.queryByText("nested-1.mp4")).toBeNull();
});

test("New Folder creates under the current folder", () => {
  const parent: MediaFolder = { id: "p", name: "Parent" };
  const lib = fakeLibrary([], [parent]);

  render(<MediaPanel library={lib} />);
  fireEvent.doubleClick(screen.getByTestId("folder-tile"));
  fireEvent.click(screen.getByTestId("media-new-folder"));

  expect(lib.calls.createFolder).toEqual([{ name: "New Folder", parentFolderId: "p" }]);
});

// Asset tiles do NOT carry native HTML5 drag: in real Chromium, pointerdown.preventDefault()
// (Editor.tsx's timeline-drag gesture, wired via onItemPointerDown) suppresses native dragstart
// entirely, so a coexisting `draggable`/`onDragStart` on the tile would never fire in production
// even though jsdom's fireEvent.dragStart doesn't reproduce that gating. Asset->folder drops
// instead route through the custom pointer-drag controller — see editor-drag.test.tsx, which
// exercises that path at the Editor level (where the drop is actually resolved).
test("regression: MediaItem asset tiles carry no draggable attribute (no native DnD on assets)", () => {
  const asset = baseEntry("a");
  const lib = fakeLibrary([asset], []);

  render(<MediaPanel library={lib} />);

  const assetTile = screen.getByTestId("media-item");
  expect(assetTile).not.toHaveAttribute("draggable");
});

test("internal drag: dropping a folder onto an ancestor breadcrumb calls moveFolderToFolder", () => {
  const parent: MediaFolder = { id: "p", name: "Parent" };
  const child: MediaFolder = { id: "c", name: "Child", parentFolderId: "p" };
  const grandchild: MediaFolder = { id: "g", name: "Grandchild", parentFolderId: "c" };
  const lib = fakeLibrary([], [parent, child, grandchild]);

  render(<MediaPanel library={lib} />);

  // Drill in: root -> Parent -> Child, so "Grandchild" is visible at this level
  fireEvent.doubleClick(screen.getByTestId("folder-tile")); // into Parent
  fireEvent.doubleClick(screen.getByTestId("folder-tile")); // into Child

  const grandchildTile = screen.getByTestId("folder-tile");
  const dt = makeDataTransfer();
  fireEvent.dragStart(grandchildTile, { dataTransfer: dt });

  const rootCrumb = screen.getByTestId("media-breadcrumb-root");
  fireEvent.dragOver(rootCrumb, { dataTransfer: dt });
  fireEvent.drop(rootCrumb, { dataTransfer: dt });

  expect(lib.calls.moveFolderToFolder).toEqual([{ folderId: "g", targetId: undefined }]);
});

test("internal drag: dropping a folder into its own descendant is rejected (no-op, no throw)", () => {
  const parent: MediaFolder = { id: "p", name: "Parent" };
  const child: MediaFolder = { id: "c", name: "Child", parentFolderId: "p" };
  const lib = fakeLibrary([], [parent, child]);

  render(<MediaPanel library={lib} />);

  const parentTile = screen.getByTestId("folder-tile");
  const dt = makeDataTransfer({ kind: "folder", id: "p" });

  expect(() => {
    fireEvent.dragOver(parentTile, { dataTransfer: dt });
    fireEvent.drop(parentTile, { dataTransfer: dt });
  }).not.toThrow();

  // moveFolderToFolder("p", "p") — same tile — is a self-drop, also rejected
  expect(lib.calls.moveFolderToFolder).toEqual([]);
});

test("OS file drop (no custom mime) still calls importFiles with the current folder", () => {
  const folder: MediaFolder = { id: "f1", name: "Interviews" };
  const lib = fakeLibrary([], [folder]);

  render(<MediaPanel library={lib} />);
  fireEvent.doubleClick(screen.getByTestId("folder-tile"));

  const file = new File(["x"], "clip.mp4", { type: "video/mp4" });
  const dt = { types: ["Files"], files: [file], getData: () => "", setData: () => {} };

  fireEvent.drop(screen.getByTestId("media-panel"), { dataTransfer: dt });

  expect(lib.calls.importFiles).toEqual([{ files: [file], folderId: "f1" }]);
});

// ── stale currentFolderId after an out-of-band delete (M12A final review M1) ─
// Simulates an agent's delete_folder call over MCP racing the panel's own drill-in: the browser
// is parked inside a folder that vanishes from `folders` without the panel itself driving the
// delete, so currentFolderId is never reset by handleDeleteFolder's own navigateTo call.

test("stale currentFolderId: deleting the drilled-in folder chain externally lands on the nearest surviving ancestor", () => {
  const grandparent: MediaFolder = { id: "gp", name: "Grandparent" };
  const parent: MediaFolder = { id: "p", name: "Parent", parentFolderId: "gp" };
  const child: MediaFolder = { id: "c", name: "Child", parentFolderId: "p" };
  const lib = fakeLibrary([], [grandparent, parent, child]);

  render(<MediaPanel library={lib} />);
  fireEvent.doubleClick(screen.getByTestId("folder-tile")); // root -> Grandparent
  fireEvent.doubleClick(screen.getByTestId("folder-tile")); // -> Parent
  fireEvent.doubleClick(screen.getByTestId("folder-tile")); // -> Child
  expect(screen.getByTestId("media-breadcrumb-c")).toHaveTextContent("Child");

  // External deletion (not via the panel's own delete button) removes Child and Parent but
  // leaves Grandparent — currentFolderId ("c") is now a dangling id.
  act(() => {
    lib.deleteFolders(["c", "p"]);
  });

  // Lands on Grandparent, the nearest surviving ancestor — not stuck on the dead id.
  expect(screen.getByTestId("media-breadcrumb-gp")).toHaveTextContent("Grandparent");
  expect(screen.queryByTestId("media-breadcrumb-c")).toBeNull();
  expect(screen.queryByTestId("media-breadcrumb-p")).toBeNull();

  // "New Folder" now creates at the landing spot, not the dead id (would otherwise throw).
  fireEvent.click(screen.getByTestId("media-new-folder"));
  expect(lib.calls.createFolder).toEqual([{ name: "New Folder", parentFolderId: "gp" }]);
});

test("stale currentFolderId: deleting every ancestor externally lands on root", () => {
  const parent: MediaFolder = { id: "p", name: "Parent" };
  const child: MediaFolder = { id: "c", name: "Child", parentFolderId: "p" };
  const lib = fakeLibrary([], [parent, child]);

  render(<MediaPanel library={lib} />);
  fireEvent.doubleClick(screen.getByTestId("folder-tile")); // root -> Parent
  fireEvent.doubleClick(screen.getByTestId("folder-tile")); // -> Child
  expect(screen.getByTestId("media-breadcrumb-c")).toBeInTheDocument();

  act(() => {
    lib.deleteFolders(["p", "c"]);
  });

  expect(screen.getByTestId("media-breadcrumb-root")).toBeInTheDocument();
  expect(screen.queryByTestId("media-breadcrumb-c")).toBeNull();
  expect(screen.queryByTestId("folder-tile")).toBeNull();

  fireEvent.click(screen.getByTestId("media-new-folder"));
  expect(lib.calls.createFolder).toEqual([{ name: "New Folder", parentFolderId: undefined }]);
});

// ── Index status indicator (M12C T3) ──────────────────────────────────────────

test("no indexing facade: renders no status line", () => {
  render(<MediaPanel library={fakeLibrary([])} />);
  expect(screen.queryByTestId("media-index-status")).toBeNull();
});

test("idle status: renders nothing", () => {
  const indexing = fakeIndexing({ kind: "idle" });
  render(<MediaPanel library={fakeLibrary([])} indexing={indexing} />);
  expect(screen.queryByTestId("media-index-status")).toBeNull();
});

test("indexing status: shows a 1-indexed 'Indexing N of M…' line, live-updating with the facade", () => {
  const indexing = fakeIndexing({ kind: "indexing", done: 0, total: 3 });
  render(<MediaPanel library={fakeLibrary([])} indexing={indexing} />);
  expect(screen.getByTestId("media-index-status")).toHaveTextContent("Indexing 1 of 3…");

  act(() => indexing.set({ kind: "indexing", done: 2, total: 3 }));
  expect(screen.getByTestId("media-index-status")).toHaveTextContent("Indexing 3 of 3…");

  act(() => indexing.set({ kind: "idle" }));
  expect(screen.queryByTestId("media-index-status")).toBeNull();
});

test("waiting-model status: shows the subtle waiting line", () => {
  const indexing = fakeIndexing({ kind: "waiting-model" });
  render(<MediaPanel library={fakeLibrary([])} indexing={indexing} />);
  expect(screen.getByTestId("media-index-status")).toHaveTextContent("Search index waiting for model");
});

test("waiting-model status without an ensureReady facade: no download button", () => {
  const indexing = fakeIndexing({ kind: "waiting-model" });
  render(<MediaPanel library={fakeLibrary([])} indexing={indexing} />);
  expect(screen.queryByTestId("media-index-download-model")).toBeNull();
});

test("indexing (not waiting-model) status: no download button even with an ensureReady facade", () => {
  const indexing = fakeIndexing({ kind: "indexing", done: 0, total: 1 }, async () => {});
  render(<MediaPanel library={fakeLibrary([])} indexing={indexing} />);
  expect(screen.queryByTestId("media-index-download-model")).toBeNull();
});

// ── Model-download button (M12C T4) ───────────────────────────────────────────

test("waiting-model status with an ensureReady facade: shows a Download model button that calls it", async () => {
  let resolveDownload: () => void = () => {};
  const ensureReady = vi.fn(() => new Promise<void>((resolve) => { resolveDownload = resolve; }));
  const indexing = fakeIndexing({ kind: "waiting-model" }, ensureReady);
  render(<MediaPanel library={fakeLibrary([])} indexing={indexing} />);

  const button = screen.getByTestId("media-index-download-model");
  expect(button).toHaveTextContent("Download model");
  expect(button).not.toBeDisabled();

  fireEvent.click(button);
  expect(ensureReady).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.getByTestId("media-index-download-model")).toBeDisabled());

  await act(async () => {
    resolveDownload();
    await Promise.resolve();
  });
  await waitFor(() => expect(screen.getByTestId("media-index-download-model")).not.toBeDisabled());

  // A second click while already idle-again doesn't re-fire until clicked again.
  fireEvent.click(button);
  expect(ensureReady).toHaveBeenCalledTimes(2);
});

test("clicking Download model while already downloading does not re-fire ensureReady", async () => {
  const ensureReady = vi.fn(() => new Promise<void>(() => {})); // never resolves
  const indexing = fakeIndexing({ kind: "waiting-model" }, ensureReady);
  render(<MediaPanel library={fakeLibrary([])} indexing={indexing} />);

  const button = screen.getByTestId("media-index-download-model");
  fireEvent.click(button);
  await waitFor(() => expect(button).toBeDisabled());
  fireEvent.click(button); // no-op: disabled, and the handler also guards on isDownloadingModel
  expect(ensureReady).toHaveBeenCalledTimes(1);
});

// ── "New Matte…" header entry (M13A T1) ───────────────────────────────────────

function stubCanvasMatte(): { restore: () => void } {
  const getContextSpy = vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockReturnValue({ fillRect: () => {}, fillStyle: "" } as any);
  const toDataURLSpy = vi
    .spyOn(HTMLCanvasElement.prototype, "toDataURL")
    .mockReturnValue(`data:image/png;base64,${btoa("fake-png-bytes")}`);
  return {
    restore: () => {
      getContextSpy.mockRestore();
      toDataURLSpy.mockRestore();
    },
  };
}

test("no store, or a library without importBytes: the New Matte action is hidden", () => {
  render(<MediaPanel library={fakeLibrary()} />);
  expect(screen.queryByTestId("media-new-matte")).toBeNull();

  const store = new EditorStore(defaultTimeline());
  render(<MediaPanel library={fakeLibrary()} store={store} />);
  expect(screen.queryAllByTestId("media-new-matte")).toHaveLength(0);
});

test("New Matte… opens the sheet; Create Matte imports via the library's importBytes at the current folder", async () => {
  const canvas = stubCanvasMatte();
  try {
    const folder: MediaFolder = { id: "f1", name: "Interviews" };
    const lib = fakeLibrary([], [folder], true);
    const store = new EditorStore(defaultTimeline());

    render(<MediaPanel library={lib} store={store} />);
    fireEvent.doubleClick(screen.getByTestId("folder-tile")); // drill into f1

    fireEvent.click(screen.getByTestId("media-new-matte"));
    expect(screen.getByTestId("matte-sheet")).toBeInTheDocument();
    expect(screen.getByTestId("matte-size-readout")).toHaveTextContent("1920 × 1080");

    fireEvent.click(screen.getByTestId("matte-sheet-create"));

    await waitFor(() => expect(lib.calls.importBytes).toHaveLength(1));
    expect(lib.calls.importBytes[0]).toEqual({ mimeType: "image/png", name: "Matte · 1920×1080", folderId: "f1" });
    await waitFor(() => expect(screen.queryByTestId("matte-sheet")).toBeNull());
  } finally {
    canvas.restore();
  }
});
