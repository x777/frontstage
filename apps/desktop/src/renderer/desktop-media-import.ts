import { createImportPlaceholderEntry } from "@palmier/core";
import type { ClipType } from "@palmier/core";
import { MediaLibrary, probeMediaBlob } from "@palmier/ui";
import { extensionForImportMime, extensionForImportUrl, importTypeForExtension } from "@palmier/ai";
import type { ToolContext } from "@palmier/ai";
import type { ImportScanFile } from "./desktop-audio-extract.js";

export interface DesktopMediaImportDeps {
  library: MediaLibrary;
  // The open project's absolute directory — undefined when no project is open.
  getProjectDir: () => string | undefined;
}

function projectRelativePath(entry: { source: { kind: string; relativePath?: string } }): string {
  if (entry.source.kind !== "project" || !entry.source.relativePath) {
    throw new Error("import placeholder must have a project-relative source");
  }
  return entry.source.relativePath;
}

function stemName(rel: string): string {
  const base = rel.split("/").pop() ?? rel;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

// Desktop's ToolContext.mediaImport facade (M12A T3): bytes reuse MediaLibrary.importBytes
// directly (no IPC needed — pure JS decode); url/path stream through main via IPC so raw bytes
// never cross the renderer boundary in bulk, then read back from disk to probe/finalize.
export function createDesktopMediaImport(deps: DesktopMediaImportDeps): NonNullable<ToolContext["mediaImport"]> {
  const { library, getProjectDir } = deps;

  function requireProjectDir(): string {
    const dir = getProjectDir();
    if (!dir) throw new Error("No project is open; cannot import media");
    return dir;
  }

  async function readBackAndFinish(id: string, dir: string, relPath: string, type: ClipType): Promise<void> {
    try {
      const bytes = await window.desktopProject.readMedia(dir, relPath);
      const blob = new Blob([bytes as BlobPart]);
      const probed = await probeMediaBlob(blob, type);
      if (probed.thumb) library.setThumbnail(id, probed.thumb);
      library.finalizeGenerated(id, bytes, {
        duration: probed.duration,
        ...(probed.sourceWidth !== undefined ? { sourceWidth: probed.sourceWidth } : {}),
        ...(probed.sourceHeight !== undefined ? { sourceHeight: probed.sourceHeight } : {}),
        ...(probed.hasAudio !== undefined ? { hasAudio: probed.hasAudio } : {}),
      });
    } catch (err) {
      library.markGenerationFailed([id], err instanceof Error ? err.message : String(err));
    }
  }

  async function fromBytes(bytes: Uint8Array, mimeType: string, name?: string, folderId?: string): Promise<{ assetId: string }> {
    return library.importBytes(bytes, mimeType, name, folderId);
  }

  async function fromUrl(url: string, name?: string, folderId?: string, mimeType?: string): Promise<{ assetId: string }> {
    const dir = requireProjectDir();
    const ext = mimeType ? extensionForImportMime(mimeType) : extensionForImportUrl(url);
    const type = ext ? importTypeForExtension(ext) : undefined;
    if (!ext || !type) throw new Error("Cannot infer media type from URL. Set source.mimeType to disambiguate.");

    const id = crypto.randomUUID();
    const displayName = name ?? stemName(new URL(url).pathname) ?? "Imported asset";
    const entry = createImportPlaceholderEntry({ id, type, name: displayName || "Imported asset", ext, folderId });
    library.addPlaceholder(entry);

    const rel = projectRelativePath(entry);
    void (async () => {
      const result = await window.desktopMedia.importDownload(dir, url, rel);
      if ("error" in result) {
        library.markGenerationFailed([id], result.error);
        return;
      }
      await readBackAndFinish(id, dir, rel, type);
    })();

    return { assetId: id };
  }

  async function fromPath(absPath: string, folderId?: string): Promise<{ assetIds: string[] }> {
    const dir = requireProjectDir();
    const scan = await window.desktopMedia.importScan(dir, absPath);
    if ("error" in scan) throw new Error(scan.error);
    if (scan.files.length === 0) return { assetIds: [] };

    // Mirror scan.dirs (shallow-to-deep, since Object.keys preserves insertion/scan order and the
    // main-process walker emits a parent before any of its children) as folders under folderId.
    const folderIdByRelDir = new Map<string, string | undefined>([["", folderId]]);
    for (const relDir of scan.dirs) {
      const slash = relDir.lastIndexOf("/");
      const parentRel = slash === -1 ? "" : relDir.slice(0, slash);
      const name = slash === -1 ? relDir : relDir.slice(slash + 1);
      const parentFolderId = folderIdByRelDir.get(parentRel);
      const folder = library.createFolder(name, parentFolderId);
      folderIdByRelDir.set(relDir, folder.id);
    }

    const assetIds: string[] = [];
    for (const file of scan.files as ImportScanFile[]) {
      const type = importTypeForExtension(file.ext);
      if (!type) continue; // main already filtered by extension; defensive only

      const slash = file.rel.lastIndexOf("/");
      const dirRel = slash === -1 ? "" : file.rel.slice(0, slash);
      const destFolderId = folderIdByRelDir.get(dirRel) ?? folderId;

      const id = crypto.randomUUID();
      const entry = createImportPlaceholderEntry({ id, type, name: stemName(file.rel), ext: file.ext, folderId: destFolderId });
      library.addPlaceholder(entry);
      assetIds.push(id);

      const rel = projectRelativePath(entry);
      void (async () => {
        const copyResult = await window.desktopMedia.importCopy(dir, file.abs, rel);
        if ("error" in copyResult) {
          library.markGenerationFailed([id], copyResult.error);
          return;
        }
        await readBackAndFinish(id, dir, rel, type);
      })();
    }

    return { assetIds };
  }

  return { fromBytes, fromUrl, fromPath };
}
