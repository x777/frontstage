/**
 * M12A T4 defect fix — asset->folder drag routes through the custom pointer-drag controller
 * (MediaDragController), not native HTML5 DnD.
 *
 * Why: in real Chromium, MediaPanel's onPointerDown -> Editor's onItemPointerDown calls
 * e.preventDefault(), which suppresses native `dragstart` from ever firing on asset tiles
 * (verified empirically — jsdom doesn't implement this gating, which is why the old
 * fireEvent.dragStart-based test in MediaPanel.test.tsx passed despite the feature being
 * broken in production). So this test exercises the real gesture: pointerdown on the tile,
 * pointermove, pointerup over a `[data-folder-drop]` element — with document.elementFromPoint
 * mocked, since jsdom returns null for it (no real layout engine).
 *
 * Approach: full <Editor> RTL, mirroring editor-agent.test.tsx — PreviewPanel/TimelinePanel
 * are mocked (WebGPU/canvas don't work in jsdom) but MediaPanel is NOT mocked, since the
 * gesture spans MediaPanel (MediaItem/FolderTile/MediaBreadcrumbs) + Editor's document-level
 * pointer listeners.
 */

import { vi } from "vitest";

vi.mock("../src/preview/PreviewPanel.js", () => ({
  PreviewPanel: () => <div data-testid="stub-preview" />,
}));
vi.mock("../src/timeline/TimelinePanel.js", () => ({
  TimelinePanel: () => <div data-testid="stub-timeline" />,
}));

import { render, screen, fireEvent } from "@testing-library/react";
import { EditorStore, defaultTimeline, type MediaFolder, type MediaManifestEntry } from "@frontstage/core";
import type { MediaByteSource } from "@frontstage/engine";
import { Editor, type EditorLibrary } from "../src/editor/Editor.js";

function makeLibrary() {
  const calls = {
    moveEntriesToFolder: [] as Array<{ assetIds: string[]; folderId: string | undefined }>,
  };
  const entries: MediaManifestEntry[] = [
    { id: "media-1", name: "clip.mp4", type: "video", source: { kind: "external", absolutePath: "/tmp/clip.mp4" }, duration: 4 },
  ];
  const folders: MediaFolder[] = [{ id: "f1", name: "Interviews" }];
  const lib: EditorLibrary = {
    getSnapshot: () => ({ entries, folders }),
    subscribe: () => () => {},
    thumbnail: () => undefined,
    importFiles: async () => [],
    entry: (id) => entries.find((e) => e.id === id),
    createFolder: () => ({ id: "new", name: "New Folder" }),
    renameFolder: () => {},
    deleteFolders: () => ({ removedAssetIds: [] }),
    moveEntriesToFolder: (assetIds, folderId) => {
      calls.moveEntriesToFolder.push({ assetIds, folderId });
    },
    moveFolderToFolder: () => {},
  };
  return { lib, calls };
}

function renderEditor(lib: EditorLibrary, store = new EditorStore(defaultTimeline())) {
  render(<Editor store={store} media={{} as MediaByteSource} library={lib} />);
  return store;
}

// jsdom has no layout engine, so `document.elementFromPoint` isn't implemented at all (not even
// as a stub returning null) — assign it directly rather than vi.spyOn, which requires the
// property to already exist.
function stubElementFromPoint(target: Element | null): () => void {
  const doc = document as unknown as { elementFromPoint: (x: number, y: number) => Element | null };
  doc.elementFromPoint = () => target;
  return () => {
    delete (document as { elementFromPoint?: unknown }).elementFromPoint;
  };
}

test("asset->folder drag: pointerdown+move+up over a folder tile calls moveEntriesToFolder and skips the timeline drop", () => {
  const { lib, calls } = makeLibrary();
  const store = renderEditor(lib);
  const dispatchSpy = vi.spyOn(store, "dispatch");

  const assetTile = screen.getByTestId("media-item");
  const folderTile = screen.getByTestId("folder-tile");
  const restore = stubElementFromPoint(folderTile);

  fireEvent.pointerDown(assetTile, { clientX: 50, clientY: 50 });
  fireEvent.pointerMove(document, { clientX: 60, clientY: 60 });
  // pointermove drives the same drop-hover styling FolderTile's native onDragOver would.
  expect(folderTile).toHaveAttribute("data-drop-active", "true");

  fireEvent.pointerUp(document, { clientX: 60, clientY: 60 });

  expect(calls.moveEntriesToFolder).toEqual([{ assetIds: ["media-1"], folderId: "f1" }]);
  expect(dispatchSpy).not.toHaveBeenCalled();

  restore();
});

test("asset->folder drag: dropping on the root breadcrumb moves the entry to root (folderId undefined)", () => {
  const { lib, calls } = makeLibrary();
  renderEditor(lib);

  const assetTile = screen.getByTestId("media-item");
  const rootCrumb = screen.getByTestId("media-breadcrumb-root");
  const restore = stubElementFromPoint(rootCrumb);

  fireEvent.pointerDown(assetTile, { clientX: 10, clientY: 10 });
  fireEvent.pointerMove(document, { clientX: 20, clientY: 20 });
  fireEvent.pointerUp(document, { clientX: 20, clientY: 20 });

  expect(calls.moveEntriesToFolder).toEqual([{ assetIds: ["media-1"], folderId: undefined }]);

  restore();
});

test("asset drag ending outside any folder-drop target does not call moveEntriesToFolder", () => {
  const { lib, calls } = makeLibrary();
  renderEditor(lib);

  const assetTile = screen.getByTestId("media-item");
  const restore = stubElementFromPoint(null);

  fireEvent.pointerDown(assetTile, { clientX: 10, clientY: 10 });
  fireEvent.pointerMove(document, { clientX: 500, clientY: 500 });
  fireEvent.pointerUp(document, { clientX: 500, clientY: 500 });

  expect(calls.moveEntriesToFolder).toEqual([]);

  restore();
});
