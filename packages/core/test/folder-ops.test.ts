import { describe, expect, test } from "vitest";
import type { Clip } from "../src/clip.js";
import type { MediaFolder, MediaManifestEntry } from "../src/media.js";
import { defaultTimeline, type Track } from "../src/timeline.js";
import { defaultTransform, defaultCrop } from "../src/transform.js";
import {
  buildFolderIndex,
  canMoveFolder,
  collectFolderCascade,
  folderPath,
  isDescendantFolder,
  referencingClipIds,
} from "../src/media/folder-ops.js";

function folder(id: string, name: string, parentFolderId?: string): MediaFolder {
  return parentFolderId === undefined ? { id, name } : { id, name, parentFolderId };
}

function entry(id: string, folderId?: string): MediaManifestEntry {
  const e: MediaManifestEntry = {
    id,
    name: `${id}.mp4`,
    type: "video",
    source: { kind: "project", relativePath: `media/${id}.mp4` },
    duration: 3,
  };
  if (folderId !== undefined) e.folderId = folderId;
  return e;
}

function clip(id: string, mediaRef: string, linkGroupId?: string): Clip {
  const c: Clip = {
    id, mediaRef, mediaType: "video", sourceClipType: "video",
    startFrame: 0, durationFrames: 30, trimStartFrame: 0, trimEndFrame: 0,
    speed: 1, volume: 1, fadeInFrames: 0, fadeOutFrames: 0,
    fadeInInterpolation: "linear", fadeOutInterpolation: "linear",
    opacity: 1, transform: defaultTransform(), crop: defaultCrop(),
  };
  if (linkGroupId !== undefined) c.linkGroupId = linkGroupId;
  return c;
}

function track(id: string, clips: Clip[]): Track {
  return { id, type: "video", muted: false, hidden: false, syncLocked: true, clips };
}

describe("buildFolderIndex", () => {
  test("indexes by id and groups children by parent (root keyed by null)", () => {
    const a = folder("a", "A");
    const b = folder("b", "B", "a");
    const index = buildFolderIndex([a, b]);
    expect(index.byId.get("a")).toBe(a);
    expect(index.byId.get("b")).toBe(b);
    expect(index.childrenByParent.get(null)).toEqual([a]);
    expect(index.childrenByParent.get("a")).toEqual([b]);
  });
});

describe("folderPath", () => {
  test("root/undefined folderId -> empty path", () => {
    const index = buildFolderIndex([folder("a", "A")]);
    expect(folderPath(index, undefined)).toEqual([]);
  });

  test("unknown folderId -> empty path", () => {
    const index = buildFolderIndex([folder("a", "A")]);
    expect(folderPath(index, "ghost")).toEqual([]);
  });

  test("deep nesting returns root->leaf order", () => {
    const a = folder("a", "A");
    const b = folder("b", "B", "a");
    const c = folder("c", "C", "b");
    const d = folder("d", "D", "c");
    const index = buildFolderIndex([a, b, c, d]);
    expect(folderPath(index, "d")).toEqual([a, b, c, d]);
  });

  test("corrupt parent cycle terminates instead of looping forever", () => {
    // a -> b -> a (self-referential loop introduced by corrupt data)
    const a = folder("a", "A", "b");
    const b = folder("b", "B", "a");
    const index = buildFolderIndex([a, b]);
    const path = folderPath(index, "a");
    // must terminate and must not contain a duplicated id
    expect(path.length).toBeLessThanOrEqual(2);
    expect(new Set(path.map((f) => f.id)).size).toBe(path.length);
  });

  test("direct self-parent cycle yields a single-entry path, not infinite duplicates", () => {
    const a = folder("a", "A", "a");
    const index = buildFolderIndex([a]);
    expect(folderPath(index, "a")).toEqual([a]);
  });
});

describe("isDescendantFolder", () => {
  test("a folder is its own descendant (self case, used by canMoveFolder)", () => {
    const index = buildFolderIndex([folder("a", "A")]);
    expect(isDescendantFolder(index, "a", "a")).toBe(true);
  });

  test("true for a nested descendant", () => {
    const a = folder("a", "A");
    const b = folder("b", "B", "a");
    const c = folder("c", "C", "b");
    const index = buildFolderIndex([a, b, c]);
    expect(isDescendantFolder(index, "a", "c")).toBe(true);
  });

  test("false for unrelated folders", () => {
    const a = folder("a", "A");
    const b = folder("b", "B");
    const index = buildFolderIndex([a, b]);
    expect(isDescendantFolder(index, "a", "b")).toBe(false);
  });

  test("terminates on a cyclic parent chain", () => {
    const a = folder("a", "A", "b");
    const b = folder("b", "B", "a");
    const index = buildFolderIndex([a, b]);
    expect(isDescendantFolder(index, "z", "a")).toBe(false);
  });
});

describe("canMoveFolder", () => {
  const a = folder("a", "A");
  const b = folder("b", "B", "a");
  const c = folder("c", "C", "b");
  const other = folder("other", "Other");
  const index = buildFolderIndex([a, b, c, other]);

  test("move into self is rejected", () => {
    expect(canMoveFolder(index, "a", "a")).toBe(false);
  });

  test("move into a descendant is rejected", () => {
    expect(canMoveFolder(index, "a", "c")).toBe(false);
  });

  test("move into an unknown target is rejected", () => {
    expect(canMoveFolder(index, "a", "ghost")).toBe(false);
  });

  test("move to root (undefined target) is allowed", () => {
    expect(canMoveFolder(index, "c", undefined)).toBe(true);
  });

  test("move into an unrelated existing folder is allowed", () => {
    expect(canMoveFolder(index, "c", "other")).toBe(true);
  });
});

describe("collectFolderCascade", () => {
  test("3-level tree: descendant folders and their contained assets are all collected", () => {
    const root = folder("root", "Root");
    const mid = folder("mid", "Mid", "root");
    const leaf = folder("leaf", "Leaf", "mid");
    const sibling = folder("sibling", "Sibling"); // not under root, must not be collected
    const folders = [root, mid, leaf, sibling];

    const entries = [
      entry("root-asset", "root"),
      entry("mid-asset", "mid"),
      entry("leaf-asset", "leaf"),
      entry("sibling-asset", "sibling"),
      entry("unfiled-asset"),
    ];

    const result = collectFolderCascade(folders, entries, ["root"]);

    expect(result.folderIds).toEqual(new Set(["root", "mid", "leaf"]));
    expect(result.assetIds).toEqual(new Set(["root-asset", "mid-asset", "leaf-asset"]));
  });

  test("terminates on a cyclic folder tree", () => {
    const a = folder("a", "A", "b");
    const b = folder("b", "B", "a");
    const result = collectFolderCascade([a, b], [], ["a"]);
    expect(result.folderIds).toEqual(new Set(["a", "b"]));
  });
});

describe("referencingClipIds", () => {
  test("finds clips across multiple tracks, including linked partners referencing the same asset", () => {
    const timeline = {
      ...defaultTimeline(),
      tracks: [
        track("video", [clip("v1", "asset-a", "link-1"), clip("v2", "asset-b")]),
        track("audio", [clip("a1", "asset-a", "link-1")]),
      ],
    };

    const ids = referencingClipIds(timeline, new Set(["asset-a"]));

    expect(ids.sort()).toEqual(["a1", "v1"]);
  });

  test("empty when no clip references the given assets", () => {
    const timeline = { ...defaultTimeline(), tracks: [track("video", [clip("v1", "asset-a")])] };
    expect(referencingClipIds(timeline, new Set(["asset-z"]))).toEqual([]);
  });
});
