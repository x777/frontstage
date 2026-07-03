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

// Directory imports can discover thousands of files at once (bounded by main's scan caps, but
// still up to hundreds); firing one IPC round-trip per file unthrottled floods the main process.
// A tiny fixed-size worker pool caps how many importCopy/readMedia calls are in flight at once.
const IMPORT_COPY_CONCURRENCY = 4;

async function runWithConcurrencyLimit(tasks: Array<() => Promise<void>>, limit: number): Promise<void> {
  let next = 0;
  async function worker(): Promise<void> {
    while (next < tasks.length) {
      const task = tasks[next++];
      if (task) await task();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
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
      library.finalizeGenerated(id, bytes, {
        duration: probed.duration,
        ...(probed.sourceWidth !== undefined ? { sourceWidth: probed.sourceWidth } : {}),
        ...(probed.sourceHeight !== undefined ? { sourceHeight: probed.sourceHeight } : {}),
        ...(probed.hasAudio !== undefined ? { hasAudio: probed.hasAudio } : {}),
      });
      // finalizeGenerated no-ops when the entry was deleted mid-import — skip the thumbnail too,
      // or it leaks a dangling id → dataURL entry that nothing ever revisits.
      if (probed.thumb && library.entry(id)) library.setThumbnail(id, probed.thumb);
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
    const entry = createImportPlaceholderEntry({
      id,
      type,
      name: displayName || "Imported asset",
      ext,
      folderId: library.resolveFolderId(folderId),
    });
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

    // Resolve once up front: an unknown/dangling folderId (e.g. deleted between the tool call and
    // this running) falls back to root instead of throwing on the very first createFolder below.
    const rootFolderId = library.resolveFolderId(folderId);

    // Mirror scan.dirs (shallow-to-deep, since Object.keys preserves insertion/scan order and the
    // main-process walker emits a parent before any of its children) as folders under rootFolderId.
    const folderIdByRelDir = new Map<string, string | undefined>([["", rootFolderId]]);
    for (const relDir of scan.dirs) {
      const slash = relDir.lastIndexOf("/");
      const parentRel = slash === -1 ? "" : relDir.slice(0, slash);
      const name = slash === -1 ? relDir : relDir.slice(slash + 1);
      const parentFolderId = folderIdByRelDir.get(parentRel);
      const folder = library.createFolder(name, parentFolderId);
      folderIdByRelDir.set(relDir, folder.id);
    }

    const assetIds: string[] = [];
    const tasks: Array<() => Promise<void>> = [];
    for (const file of scan.files as ImportScanFile[]) {
      const type = importTypeForExtension(file.ext);
      if (!type) continue; // main already filtered by extension; defensive only

      const slash = file.rel.lastIndexOf("/");
      const dirRel = slash === -1 ? "" : file.rel.slice(0, slash);
      const destFolderId = folderIdByRelDir.get(dirRel) ?? rootFolderId;

      const id = crypto.randomUUID();
      const entry = createImportPlaceholderEntry({ id, type, name: stemName(file.rel), ext: file.ext, folderId: destFolderId });
      library.addPlaceholder(entry);
      assetIds.push(id);

      const rel = projectRelativePath(entry);
      tasks.push(async () => {
        const copyResult = await window.desktopMedia.importCopy(dir, file.abs, rel);
        if ("error" in copyResult) {
          library.markGenerationFailed([id], copyResult.error);
          return;
        }
        await readBackAndFinish(id, dir, rel, type);
      });
    }

    // All placeholders are created synchronously above (placeholder-first ordering is preserved);
    // the actual copy/probe work runs in the background through a small concurrency-limited pool
    // so a large directory can't fan out hundreds of simultaneous IPC round-trips at once.
    void runWithConcurrencyLimit(tasks, IMPORT_COPY_CONCURRENCY);

    return { assetIds };
  }

  return { fromBytes, fromUrl, fromPath };
}
