import type { MediaFolder, MediaManifestEntry } from "../media.js";
import type { Timeline } from "../timeline.js";

// Port of Swift's private `MediaFolderIndex` (EditorViewModel+Folders.swift): cached
// byId/childrenByParent lookup tables built once, reused across path/descendant/cascade queries.
export interface FolderIndex {
  byId: Map<string, MediaFolder>;
  childrenByParent: Map<string | null, MediaFolder[]>;
}

export function buildFolderIndex(folders: MediaFolder[]): FolderIndex {
  const byId = new Map<string, MediaFolder>();
  const childrenByParent = new Map<string | null, MediaFolder[]>();
  for (const f of folders) {
    byId.set(f.id, f);
    const key = f.parentFolderId ?? null;
    const siblings = childrenByParent.get(key);
    if (siblings) siblings.push(f);
    else childrenByParent.set(key, [f]);
  }
  return { byId, childrenByParent };
}

// Root->leaf walk up the parentFolderId chain. A visited set (not just a hop cap) stops on the
// first repeated id, so a corrupt/cyclic parent chain terminates cleanly with no duplicate
// entries — this can never exceed folders.length steps, since there are only that many ids.
export function folderPath(index: FolderIndex, folderId: string | undefined): MediaFolder[] {
  const path: MediaFolder[] = [];
  const visited = new Set<string>();
  let current = folderId;
  while (current !== undefined && !visited.has(current)) {
    visited.add(current);
    const f = index.byId.get(current);
    if (!f) break;
    path.push(f);
    current = f.parentFolderId;
  }
  return path.reverse();
}

// Is `folderId` equal to `ancestorId`, or nested somewhere under it? (self counts, matching
// Swift's isDescendant — callers combine with an explicit self check where that reads clearer.)
export function isDescendantFolder(index: FolderIndex, ancestorId: string, folderId: string): boolean {
  let current: string | undefined = folderId;
  const visited = new Set<string>();
  while (current !== undefined && !visited.has(current)) {
    visited.add(current);
    if (current === ancestorId) return true;
    current = index.byId.get(current)?.parentFolderId;
  }
  return false;
}

export function canMoveFolder(index: FolderIndex, folderId: string, targetId: string | undefined): boolean {
  if (targetId === undefined) return true; // move to root always allowed
  if (targetId === folderId) return false;
  if (!index.byId.has(targetId)) return false;
  return !isDescendantFolder(index, folderId, targetId);
}

// Recursive descendant folders + every asset whose folderId lands in the doomed set (Swift's
// idsIncludingDescendants + assetIds(inFolderIds:)). Insert-then-recurse guards cyclic data.
export function collectFolderCascade(
  folders: MediaFolder[],
  entries: MediaManifestEntry[],
  folderIds: string[],
): { folderIds: Set<string>; assetIds: Set<string> } {
  const index = buildFolderIndex(folders);
  const doomed = new Set<string>(folderIds);

  const collectDescendants = (id: string): void => {
    for (const child of index.childrenByParent.get(id) ?? []) {
      if (!doomed.has(child.id)) {
        doomed.add(child.id);
        collectDescendants(child.id);
      }
    }
  };
  for (const id of folderIds) collectDescendants(id);

  const assetIds = new Set<string>();
  for (const e of entries) {
    if (e.folderId !== undefined && doomed.has(e.folderId)) assetIds.add(e.id);
  }
  return { folderIds: doomed, assetIds };
}

export function referencingClipIds(timeline: Timeline, assetIds: ReadonlySet<string>): string[] {
  const ids: string[] = [];
  for (const track of timeline.tracks) {
    for (const clip of track.clips) {
      if (assetIds.has(clip.mediaRef)) ids.push(clip.id);
    }
  }
  return ids;
}
