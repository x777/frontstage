import { z } from "zod";
import { collectFolderCascade, referencingClipIds, removeClipCommand } from "@palmier/core";
import type { ClipType, MediaFolder } from "@palmier/core";
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

// ── import_media (M12A T3) ───────────────────────────────────────────────────
// Caps + allowlist ported verbatim from Swift ToolExecutor+Import.swift, minus json/Lottie
// (deviation: no Lottie clip type in this build — json is rejected with a dedicated message).

export const REMOTE_IMPORT_MAX_BYTES = 5 * 1024 * 1024 * 1024;
export const REMOTE_IMPORT_TIMEOUT_MS = 15 * 60 * 1000;
export const IMPORT_BYTES_MAX_BASE64_LENGTH = 15 * 1024 * 1024;

export const IMPORT_EXT_TO_TYPE: Readonly<Record<string, ClipType>> = {
  mp4: "video",
  mov: "video",
  mp3: "audio",
  wav: "audio",
  aac: "audio",
  m4a: "audio",
  aiff: "audio",
  aifc: "audio",
  flac: "audio",
  png: "image",
  jpg: "image",
  jpeg: "image",
  tiff: "image",
  heic: "image",
};

export const IMPORT_MIME_TO_EXT: Readonly<Record<string, string>> = {
  "video/mp4": "mp4",
  "video/mpeg4": "mp4",
  "video/quicktime": "mov",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/aac": "aac",
  "audio/mp4": "m4a",
  "audio/m4a": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aiff": "aiff",
  "audio/x-aiff": "aiff",
  "audio/aifc": "aifc",
  "audio/x-aifc": "aifc",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/tiff": "tiff",
  "image/heic": "heic",
  "image/heif": "heic",
};

// Ported verbatim from Swift's acceptedMimeTypesMessage.
const ACCEPTED_MIME_TYPES_MESSAGE =
  "Accepted: video/mp4, video/quicktime, audio/mpeg, audio/wav, audio/aac, audio/mp4, audio/aiff, audio/flac, image/png, image/jpeg, image/tiff, image/heic.";
const SUPPORTED_EXTENSIONS_TEXT =
  "Supported: mov/mp4, mp3/wav/aac/m4a/aiff/aifc/flac, png/jpg/jpeg/tiff/heic.";
const MEDIA_IMPORT_UNAVAILABLE = "media import is not available in this context";

function isLottieMime(mime: string): boolean {
  const m = mime.toLowerCase();
  return m === "application/json" || m === "application/vnd.lottie+json";
}

function isLottieExt(ext: string): boolean {
  const e = ext.toLowerCase();
  return e === "json" || e === "lottie";
}

function unsupportedMimeMessage(mime: string): string {
  if (isLottieMime(mime)) {
    return `Unsupported mimeType '${mime}': Lottie/JSON imports are not supported (no Lottie clip type in this build). ${ACCEPTED_MIME_TYPES_MESSAGE}`;
  }
  return `Unsupported mimeType '${mime}'. ${ACCEPTED_MIME_TYPES_MESSAGE}`;
}

function unsupportedExtensionMessage(ext: string): string {
  if (isLottieExt(ext)) {
    return `Unsupported file extension '.${ext}': Lottie imports are not supported (no Lottie clip type in this build). ${SUPPORTED_EXTENSIONS_TEXT}`;
  }
  return `Unsupported file extension '.${ext}'. ${SUPPORTED_EXTENSIONS_TEXT}`;
}

export function extensionForImportMime(mimeType: string): string | undefined {
  return IMPORT_MIME_TO_EXT[mimeType.toLowerCase()];
}

export function importTypeForExtension(ext: string): ClipType | undefined {
  return IMPORT_EXT_TO_TYPE[ext.toLowerCase()];
}

// Last path segment's extension, "" when there is none (no dot, or a leading dotfile like ".gitignore").
function extOf(pathname: string): string {
  const last = pathname.split("/").pop() ?? "";
  const dot = last.lastIndexOf(".");
  if (dot <= 0) return "";
  return last.slice(dot + 1).toLowerCase();
}

export function extensionForImportUrl(url: string): string | undefined {
  try {
    const ext = extOf(new URL(url).pathname);
    return ext && IMPORT_EXT_TO_TYPE[ext] ? ext : undefined;
  } catch {
    return undefined;
  }
}

function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const importSourceSchema = z.object({
  url: z.string().optional(),
  path: z.string().optional(),
  bytes: z.string().optional(),
  mimeType: z.string().optional(),
});

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function importMediaTool(): ToolSpec {
  return {
    name: "import_media",
    description:
      "Imports external media into the project's library — the bridge for assets coming from other MCP servers (stock libraries, music services, web search) or local files the user already has. The 'source' object must set exactly one of: url (HTTPS only — downloaded in the background; max 5 GB), path (absolute local file path — copied into the project in the background; may also be a directory, imported recursively, mirroring its subfolder structure as media folders; desktop only), or bytes (base64-encoded inline data — max ~15 MB of base64; use url/path for anything larger). For url, type is inferred from the URL path's file extension unless source.mimeType is set as an override. For bytes, source.mimeType is required. Supported types: video (mp4, mov), audio (mp3, wav, aac, m4a, aiff, aifc, flac), image (png, jpg, jpeg, tiff, heic). Lottie/JSON is not supported. Returns a placeholder asset id immediately; the asset becomes usable once the copy/download completes — poll get_media.",
    inputSchema: z.object({
      source: importSourceSchema.optional(),
      name: z.string().optional(),
      folderId: z.string().optional(),
    }),
    async run(args, ctx): Promise<ToolResult> {
      const a = args as { source?: { url?: string; path?: string; bytes?: string; mimeType?: string }; name?: string; folderId?: string };
      const facade = ctx.mediaImport;
      if (!facade) return errorResult(MEDIA_IMPORT_UNAVAILABLE);

      const source = a.source;
      if (!source) return errorResult("Missing required 'source' object");

      const { url, path, bytes, mimeType } = source;
      const setCount = [url, path, bytes].filter((v) => v !== undefined).length;
      if (setCount !== 1) {
        return errorResult(`source must set exactly one of 'url', 'path', or 'bytes' (got ${setCount})`);
      }

      if (a.folderId !== undefined && ctx.library) {
        const known = new Set(ctx.library.listFolders().map((f) => f.id));
        if (!known.has(a.folderId)) return errorResult(`folderId not found: ${a.folderId}`);
      }

      if (path !== undefined) {
        if (!facade.fromPath) return errorResult("import_media: path imports are not available on web");
        try {
          const { assetIds } = await facade.fromPath(path, a.folderId);
          if (assetIds.length === 0) return errorResult(`No supported media found at path: ${path}`);
          return ok(
            `Import started. ${assetIds.length} placeholder asset(s) registered: ${assetIds.join(", ")}. Status: downloading. Poll get_media / list_folders; assets appear once the copy completes.`,
          );
        } catch (err) {
          return errorResult(toMessage(err));
        }
      }

      if (bytes !== undefined) {
        if (!mimeType) return errorResult("source.mimeType is required when source.bytes is set");
        if (bytes.length > IMPORT_BYTES_MAX_BASE64_LENGTH) {
          return errorResult(
            `source.bytes is too large (${bytes.length} chars; max ${IMPORT_BYTES_MAX_BASE64_LENGTH}). Use source.url or source.path for larger files.`,
          );
        }
        if (isLottieMime(mimeType) || !extensionForImportMime(mimeType)) return errorResult(unsupportedMimeMessage(mimeType));

        let decoded: Uint8Array;
        try {
          decoded = decodeBase64(bytes);
        } catch {
          return errorResult("source.bytes is not valid non-empty base64");
        }
        if (decoded.length === 0) return errorResult("source.bytes is not valid non-empty base64");

        try {
          const { assetId } = await facade.fromBytes(decoded, mimeType, a.name, a.folderId);
          return ok(
            `Import started. Placeholder asset id: ${assetId}. Status: downloading. Poll get_media; the asset appears once processing completes.`,
          );
        } catch (err) {
          return errorResult(toMessage(err));
        }
      }

      // url
      let parsed: URL;
      try {
        parsed = new URL(url!);
      } catch {
        return errorResult("source.url is not a valid URL");
      }
      if (parsed.protocol !== "https:") return errorResult("source.url must use https");
      if (parsed.username || parsed.password) return errorResult("source.url must not embed credentials");
      if (!parsed.hostname) return errorResult("source.url has no host");

      if (mimeType !== undefined) {
        if (isLottieMime(mimeType) || !extensionForImportMime(mimeType)) return errorResult(unsupportedMimeMessage(mimeType));
      } else {
        const urlExt = extOf(parsed.pathname);
        if (isLottieExt(urlExt)) return errorResult(unsupportedExtensionMessage(urlExt));
        if (!urlExt || !importTypeForExtension(urlExt)) {
          const shown = urlExt ? `.${urlExt}` : "(none)";
          return errorResult(
            `Cannot infer media type from URL extension ${shown}. Set source.mimeType to disambiguate (e.g. 'video/mp4', 'image/png').`,
          );
        }
      }

      try {
        const { assetId } = await facade.fromUrl(url!, a.name, a.folderId, mimeType);
        return ok(
          `Import started. Placeholder asset id: ${assetId}. Status: downloading. Poll get_media; the asset appears once the download completes.`,
        );
      } catch (err) {
        return errorResult(toMessage(err));
      }
    },
  };
}
