import { createImportPlaceholderEntry } from "@frontstage/core";
import { MediaLibrary, probeMediaBlob } from "@frontstage/ui";
import { extensionForImportMime, extensionForImportUrl, importTypeForExtension } from "@frontstage/ai";
import type { ToolContext } from "@frontstage/ai";

export interface WebMediaImportDeps {
  library: MediaLibrary;
  proxyUrl: () => string;
  proxyToken: () => string | undefined;
}

function stemName(pathname: string): string {
  const base = pathname.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

// Web's ToolContext.mediaImport facade (M12A T3). fromPath is intentionally omitted — path
// imports read the local filesystem, which the browser sandbox doesn't allow; the tool reports
// "not available on web" whenever this facade has no fromPath.
export function createWebMediaImport(deps: WebMediaImportDeps): NonNullable<ToolContext["mediaImport"]> {
  const { library, proxyUrl, proxyToken } = deps;

  async function fromBytes(bytes: Uint8Array, mimeType: string, name?: string, folderId?: string): Promise<{ assetId: string }> {
    return library.importBytes(bytes, mimeType, name, folderId);
  }

  async function fromUrl(url: string, name?: string, folderId?: string, mimeType?: string): Promise<{ assetId: string }> {
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

    void (async () => {
      try {
        const base = proxyUrl();
        if (!base) throw new Error("No AI proxy configured. Set the proxy URL in Settings to import from URLs.");

        const headers: Record<string, string> = { "Content-Type": "application/json" };
        const token = proxyToken();
        if (token) headers["Authorization"] = "Bearer " + token;

        let res: Response;
        try {
          res = await fetch(base + "/import/download", { method: "POST", headers, body: JSON.stringify({ url }) });
        } catch (err) {
          throw new Error(`Could not reach the AI proxy at ${base}. Check the proxy URL in Settings. (${String(err)})`);
        }
        if (!res.ok) {
          let message = "import proxy error: " + res.status;
          try {
            const body = (await res.json()) as { error?: string };
            if (body.error) message = body.error;
          } catch {
            // non-JSON error body; keep the status-based message
          }
          throw new Error(message);
        }

        const bytes = new Uint8Array(await res.arrayBuffer());
        const blob = new Blob([bytes as BlobPart]);
        const probed = await probeMediaBlob(blob, type);
        library.finalizeGenerated(id, bytes, {
          duration: probed.duration,
          ...(probed.sourceWidth !== undefined ? { sourceWidth: probed.sourceWidth } : {}),
          ...(probed.sourceHeight !== undefined ? { sourceHeight: probed.sourceHeight } : {}),
          ...(probed.hasAudio !== undefined ? { hasAudio: probed.hasAudio } : {}),
        });
        // finalizeGenerated no-ops when the entry was deleted mid-import — skip the thumbnail
        // too, or it leaks a dangling id → dataURL entry that nothing ever revisits.
        if (probed.thumb && library.entry(id)) library.setThumbnail(id, probed.thumb);
      } catch (err) {
        library.markGenerationFailed([id], err instanceof Error ? err.message : String(err));
      }
    })();

    return { assetId: id };
  }

  return { fromBytes, fromUrl };
}
