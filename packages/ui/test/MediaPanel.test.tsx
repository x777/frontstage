import { render, screen, within, fireEvent } from "@testing-library/react";
import type { MediaFolder, MediaManifestEntry } from "@palmier/core";
import { MediaPanel } from "../src/media/MediaPanel.js";
import { MEDIA_DRAG_MIME } from "../src/media/FolderTile.js";

interface FakeLibraryCalls {
  importFiles: Array<{ files: unknown; folderId: string | undefined }>;
  createFolder: Array<{ name: string; parentFolderId: string | undefined }>;
  renameFolder: Array<{ folderId: string; name: string }>;
  deleteFolders: Array<{ folderIds: string[] }>;
  moveEntriesToFolder: Array<{ assetIds: string[]; folderId: string | undefined }>;
  moveFolderToFolder: Array<{ folderId: string; targetId: string | undefined }>;
}

function fakeLibrary(initialEntries: MediaManifestEntry[] = [], initialFolders: MediaFolder[] = []) {
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

test("internal drag: dropping an asset tile onto a folder tile calls moveEntriesToFolder", () => {
  const folder: MediaFolder = { id: "f1", name: "Interviews" };
  const asset = baseEntry("a");
  const lib = fakeLibrary([asset], [folder]);

  render(<MediaPanel library={lib} />);

  const assetTile = screen.getByTestId("media-item");
  const folderTile = screen.getByTestId("folder-tile");
  const dt = makeDataTransfer();

  fireEvent.dragStart(assetTile, { dataTransfer: dt });
  fireEvent.dragOver(folderTile, { dataTransfer: dt });
  fireEvent.drop(folderTile, { dataTransfer: dt });

  expect(lib.calls.moveEntriesToFolder).toEqual([{ assetIds: ["a"], folderId: "f1" }]);
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
