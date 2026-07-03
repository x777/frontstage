import { z } from "zod";
import { collectFolderCascade, referencingClipIds, removeClipCommand } from "@palmier/core";
import type { MediaFolder } from "@palmier/core";
import type { ToolContext, ToolResult, ToolSpec } from "./types.js";
import { asUndoStep, errorResult, ok } from "./executor.js";

const LIBRARY_UNAVAILABLE = "media library is not available in this context";
const PERMANENCE_NOTE = "media removal is permanent (undo restores timeline clips only)";

function folderJson(f: MediaFolder): Record<string, unknown> {
  const out: Record<string, unknown> = { id: f.id, name: f.name };
  if (f.parentFolderId !== undefined) out.parentFolderId = f.parentFolderId;
  return out;
}

// Removes every clip referencing `doomedAssetIds` as ONE undo step (Swift parity: the delete
// cascade folds timeline cleanup and library removal into a single user-visible action, but here
// only the clip removal is undo-tracked — manifest ops are not, per M12A's undo deviation).
function removeReferencingClips(ctx: ToolContext, doomedAssetIds: ReadonlySet<string>, label: string): string[] {
  const tl = ctx.store.getSnapshot().timeline;
  const clipIds = referencingClipIds(tl, doomedAssetIds);
  if (clipIds.length > 0) {
    asUndoStep(ctx.store, label, clipIds.map((id) => { const cmd = removeClipCommand(id); return cmd.apply.bind(cmd); }));
  }
  return clipIds;
}

export function listFoldersTool(): ToolSpec {
  return {
    name: "list_folders",
    description: "Lists every folder in the media panel as {id, name, parentFolderId}. Folders are nested (parentFolderId is nil for top-level). Use to find an existing folder by name before generating new media.",
    inputSchema: z.object({}),
    run(_args, ctx) {
      const facade = ctx.library;
      if (!facade) return errorResult(LIBRARY_UNAVAILABLE);
      return ok(JSON.stringify({ folders: facade.listFolders().map(folderJson) }));
    },
  };
}

const createFolderEntry = z.object({ name: z.string(), parentFolderId: z.string().optional() });

export function createFolderTool(): ToolSpec {
  return {
    name: "create_folder",
    description: "Creates folders in the media panel. Pass either name/parentFolderId for one folder or entries for multiple folders, not both. Direct form returns one folder; entries returns { folders }. Use to organize related generations (e.g. 'Hero shot variations'). Don't create folders for unrelated concepts.",
    inputSchema: z.object({
      name: z.string().optional(),
      parentFolderId: z.string().optional(),
      entries: z.array(createFolderEntry).optional(),
    }),
    run(args, ctx) {
      const a = args as { name?: string; parentFolderId?: string; entries?: { name: string; parentFolderId?: string }[] };
      const facade = ctx.library;
      if (!facade) return errorResult(LIBRARY_UNAVAILABLE);

      const hasSingle = a.name !== undefined || a.parentFolderId !== undefined;
      if (a.entries !== undefined && hasSingle) {
        return errorResult("create_folder: pass either name/parentFolderId or entries, not both.");
      }

      const known = new Set(facade.listFolders().map((f) => f.id));
      type Spec = { name: string; parentFolderId?: string };
      let specs: Spec[];
      let isBatch: boolean;

      if (a.entries !== undefined) {
        if (a.entries.length === 0) return errorResult("Missing or empty 'entries' array");
        specs = [];
        for (let idx = 0; idx < a.entries.length; idx++) {
          const e = a.entries[idx]!;
          if (e.parentFolderId !== undefined && !known.has(e.parentFolderId)) {
            return errorResult(`entries[${idx}]: parentFolderId not found: ${e.parentFolderId}`);
          }
          specs.push({ name: e.name, parentFolderId: e.parentFolderId });
        }
        isBatch = true;
      } else {
        if (!a.name) return errorResult("Missing required argument: name");
        if (a.parentFolderId !== undefined && !known.has(a.parentFolderId)) {
          return errorResult(`create_folder: parentFolderId not found: ${a.parentFolderId}`);
        }
        specs = [{ name: a.name, parentFolderId: a.parentFolderId }];
        isBatch = false;
      }

      const folders = specs.map((s) => facade.createFolder(s.name, s.parentFolderId));
      if (!isBatch) return ok(JSON.stringify(folderJson(folders[0]!)));
      return ok(JSON.stringify({ folders: folders.map(folderJson) }));
    },
  };
}

const moveToFolderEntry = z.object({ assetIds: z.array(z.string()), folderId: z.string().optional() });

export function moveToFolderTool(): ToolSpec {
  return {
    name: "move_to_folder",
    description: "Moves media assets to folders. Pass either assetIds/folderId for one destination or entries for multiple destinations, not both. Omit folderId to move to root.",
    inputSchema: z.object({
      assetIds: z.array(z.string()).optional(),
      folderId: z.string().optional(),
      entries: z.array(moveToFolderEntry).optional(),
    }),
    run(args, ctx) {
      const a = args as { assetIds?: string[]; folderId?: string; entries?: { assetIds: string[]; folderId?: string }[] };
      const facade = ctx.library;
      if (!facade) return errorResult(LIBRARY_UNAVAILABLE);

      if (a.entries !== undefined && a.assetIds !== undefined) {
        return errorResult("move_to_folder: pass either assetIds/folderId or entries, not both.");
      }

      const knownFolders = new Set(facade.listFolders().map((f) => f.id));
      const knownAssets = new Set(ctx.getManifest().entries.map((e) => e.id));

      const validAssetIds = (ids: string[], path: string): string | null => {
        if (ids.length === 0) return `${path}: assetIds is required`;
        for (const id of ids) if (!knownAssets.has(id)) return `${path}: media asset not found: ${id}`;
        return null;
      };
      const resolveFolderId = (folderId: string | undefined): string | null | undefined => {
        if (folderId === undefined) return undefined;
        if (!knownFolders.has(folderId)) return null;
        return folderId;
      };

      type Spec = { assetIds: string[]; folderId?: string };
      let specs: Spec[];
      let isBatch: boolean;

      if (a.entries !== undefined) {
        if (a.entries.length === 0) return errorResult("Missing or empty 'entries' array");
        specs = [];
        for (let idx = 0; idx < a.entries.length; idx++) {
          const e = a.entries[idx]!;
          const path = `entries[${idx}]`;
          const err = validAssetIds(e.assetIds, path);
          if (err) return errorResult(err);
          const folderId = resolveFolderId(e.folderId);
          if (folderId === null) return errorResult(`folderId not found: ${e.folderId}`);
          specs.push({ assetIds: e.assetIds, folderId });
        }
        isBatch = true;
      } else {
        const assetIds = a.assetIds ?? [];
        const err = validAssetIds(assetIds, "move_to_folder");
        if (err) return errorResult(err);
        const folderId = resolveFolderId(a.folderId);
        if (folderId === null) return errorResult(`folderId not found: ${a.folderId}`);
        specs = [{ assetIds, folderId }];
        isBatch = false;
      }

      for (const spec of specs) facade.moveEntriesToFolder(spec.assetIds, spec.folderId);

      if (!isBatch) {
        const spec = specs[0]!;
        return ok(`Moved ${spec.assetIds.length} asset(s)${spec.folderId ? ` to folder ${spec.folderId}` : " to root"}`);
      }
      const assetCount = specs.reduce((n, s) => n + s.assetIds.length, 0);
      return ok(`Moved ${assetCount} asset(s) across ${specs.length} folder operation(s)`);
    },
  };
}

const renameMediaEntry = z.object({ mediaRef: z.string(), name: z.string() });

export function renameMediaTool(): ToolSpec {
  return {
    name: "rename_media",
    description: "Renames media assets in the library. Pass either mediaRef/name for one asset or entries for multiple assets, not both.",
    inputSchema: z.object({
      mediaRef: z.string().optional(),
      name: z.string().optional(),
      entries: z.array(renameMediaEntry).optional(),
    }),
    run(args, ctx) {
      const a = args as { mediaRef?: string; name?: string; entries?: { mediaRef: string; name: string }[] };
      const facade = ctx.library;
      if (!facade) return errorResult(LIBRARY_UNAVAILABLE);

      if (a.entries !== undefined && a.mediaRef !== undefined) {
        return errorResult("rename_media: pass either mediaRef/name or entries, not both.");
      }

      const knownAssets = new Set(ctx.getManifest().entries.map((e) => e.id));
      type Spec = { mediaRef: string; name: string };
      let specs: Spec[];
      let isBatch: boolean;

      if (a.entries !== undefined) {
        if (a.entries.length === 0) return errorResult("Missing or empty 'entries' array");
        for (const e of a.entries) {
          if (!knownAssets.has(e.mediaRef)) return errorResult(`Media asset not found: ${e.mediaRef}`);
        }
        specs = a.entries;
        isBatch = true;
      } else {
        if (!a.mediaRef) return errorResult("Missing required argument: mediaRef");
        if (!a.name) return errorResult("Missing required argument: name");
        if (!knownAssets.has(a.mediaRef)) return errorResult(`Media asset not found: ${a.mediaRef}`);
        specs = [{ mediaRef: a.mediaRef, name: a.name }];
        isBatch = false;
      }

      for (const spec of specs) facade.renameEntry(spec.mediaRef, spec.name);

      if (!isBatch) {
        const spec = specs[0]!;
        return ok(`Renamed ${spec.mediaRef} to '${spec.name}'`);
      }
      return ok(`Renamed ${specs.length} media asset${specs.length === 1 ? "" : "s"}`);
    },
  };
}

const renameFolderEntry = z.object({ folderId: z.string(), name: z.string() });

export function renameFolderTool(): ToolSpec {
  return {
    name: "rename_folder",
    description: "Renames folders in the media panel. Pass either folderId/name for one folder or entries for multiple folders, not both.",
    inputSchema: z.object({
      folderId: z.string().optional(),
      name: z.string().optional(),
      entries: z.array(renameFolderEntry).optional(),
    }),
    run(args, ctx) {
      const a = args as { folderId?: string; name?: string; entries?: { folderId: string; name: string }[] };
      const facade = ctx.library;
      if (!facade) return errorResult(LIBRARY_UNAVAILABLE);

      if (a.entries !== undefined && a.folderId !== undefined) {
        return errorResult("rename_folder: pass either folderId/name or entries, not both.");
      }

      const knownFolders = new Set(facade.listFolders().map((f) => f.id));
      type Spec = { folderId: string; name: string };
      let specs: Spec[];
      let isBatch: boolean;

      if (a.entries !== undefined) {
        if (a.entries.length === 0) return errorResult("Missing or empty 'entries' array");
        for (let idx = 0; idx < a.entries.length; idx++) {
          const e = a.entries[idx]!;
          if (!knownFolders.has(e.folderId)) return errorResult(`entries[${idx}]: folderId not found: ${e.folderId}`);
        }
        specs = a.entries;
        isBatch = true;
      } else {
        if (!a.folderId) return errorResult("Missing required argument: folderId");
        if (!a.name) return errorResult("Missing required argument: name");
        if (!knownFolders.has(a.folderId)) return errorResult(`folderId not found: ${a.folderId}`);
        specs = [{ folderId: a.folderId, name: a.name }];
        isBatch = false;
      }

      for (const spec of specs) facade.renameFolder(spec.folderId, spec.name);

      if (!isBatch) {
        const spec = specs[0]!;
        return ok(`Renamed folder ${spec.folderId} to '${spec.name}'`);
      }
      return ok(`Renamed ${specs.length} folder${specs.length === 1 ? "" : "s"}`);
    },
  };
}

export function deleteMediaTool(): ToolSpec {
  return {
    name: "delete_media",
    description: "Deletes media assets from the library. Any clips referencing them are removed from the timeline in the same undoable action.",
    inputSchema: z.object({ assetIds: z.array(z.string()).optional() }),
    run(args, ctx): ToolResult {
      const { assetIds = [] } = args as { assetIds?: string[] };
      const facade = ctx.library;
      if (!facade) return errorResult(LIBRARY_UNAVAILABLE);
      if (assetIds.length === 0) return errorResult("assetIds is required");

      const manifestEntries = ctx.getManifest().entries;
      for (const id of assetIds) {
        if (!manifestEntries.some((e) => e.id === id)) return errorResult(`Media asset not found: ${id}`);
      }

      const doomed = new Set(assetIds);
      const removedClipIds = removeReferencingClips(ctx, doomed, "Delete Media");
      facade.deleteEntries(assetIds);

      return ok(JSON.stringify({
        removedAssetIds: assetIds,
        removedClipIds,
        assetCount: assetIds.length,
        clipCount: removedClipIds.length,
        note: PERMANENCE_NOTE,
      }, null, 2));
    },
  };
}

export function deleteFolderTool(): ToolSpec {
  return {
    name: "delete_folder",
    description: "Deletes folders and everything inside them (subfolders and assets). Clips referencing any deleted asset are removed from the timeline in the same undoable action.",
    inputSchema: z.object({ folderIds: z.array(z.string()).optional() }),
    run(args, ctx): ToolResult {
      const { folderIds = [] } = args as { folderIds?: string[] };
      const facade = ctx.library;
      if (!facade) return errorResult(LIBRARY_UNAVAILABLE);
      if (folderIds.length === 0) return errorResult("folderIds is required");

      const knownFolders = new Set(facade.listFolders().map((f) => f.id));
      for (const id of folderIds) {
        if (!knownFolders.has(id)) return errorResult(`folderId not found: ${id}`);
      }

      const manifest = ctx.getManifest();
      const cascade = collectFolderCascade(manifest.folders, manifest.entries, folderIds);
      const removedClipIds = removeReferencingClips(ctx, cascade.assetIds, "Delete Folder");
      const { removedAssetIds } = facade.deleteFolders(folderIds);

      return ok(JSON.stringify({
        removedFolderIds: [...cascade.folderIds],
        removedAssetIds,
        removedClipIds,
        folderCount: cascade.folderIds.size,
        assetCount: removedAssetIds.length,
        clipCount: removedClipIds.length,
        note: PERMANENCE_NOTE,
      }, null, 2));
    },
  };
}
