import { parseTimecodeTag, type SourceTimecode } from "@frontstage/core";
import type { ToolContext } from "@frontstage/ai";
import type { ExportSaveFilter } from "./desktop-gateway.js";

export interface DesktopInteropExportDeps {
  // Resolves a mediaRef to an on-disk absolute path, or null if it isn't resolvable (in-memory-only
  // media, missing project, etc.) — mirrors the audio extractor's resolvePath.
  resolvePath(mediaRef: string): string | null;
  // The current project's real absolute directory, or undefined (no project open yet) — mirrors
  // desktop-media-import's getProjectDir. Threaded through to exportXmeml/exportFcpxml so
  // media-rep/pathurl entries are real file:// paths instead of the web best-effort fallback.
  getProjectDir(): string | undefined;
}

type ExportKind = "fcpxml" | "xmeml" | "srt" | "vtt";

const KIND_FILTERS: Record<ExportKind, ExportSaveFilter> = {
  fcpxml: { name: "FCPXML", extensions: ["fcpxml"] },
  xmeml: { name: "XMEML", extensions: ["xml"] },
  srt: { name: "SubRip Subtitle", extensions: ["srt"] },
  vtt: { name: "WebVTT Subtitle", extensions: ["vtt"] },
};

function extensionForKind(kind: ExportKind): string {
  if (kind === "xmeml") return "xml";
  return kind;
}

/**
 * Ensures `outPath` ends in the extension `kind` requires, REPLACING a mismatched one rather than
 * appending — `"reel.mp4"` (xmeml) -> `"reel.xml"`, `"reel"` -> `"reel.xml"`, `"reel.xml"` unchanged.
 * Only inspects the final path segment, so dots in directory names (`/Users/x.y/reel`) are inert.
 */
export function normalizeExportOutputPath(outPath: string, kind: ExportKind): string {
  const expectedExt = extensionForKind(kind);
  const slashIdx = Math.max(outPath.lastIndexOf("/"), outPath.lastIndexOf("\\"));
  const dir = slashIdx >= 0 ? outPath.slice(0, slashIdx + 1) : "";
  const base = slashIdx >= 0 ? outPath.slice(slashIdx + 1) : outPath;
  const dotIdx = base.lastIndexOf(".");
  const rawExt = dotIdx > 0 ? base.slice(dotIdx + 1).toLowerCase() : undefined;
  if (rawExt === expectedExt) return outPath;
  const stem = dotIdx > 0 ? base.slice(0, dotIdx) : base;
  return `${dir}${stem}.${expectedExt}`;
}

export function createDesktopInteropExport(deps: DesktopInteropExportDeps): NonNullable<ToolContext["interopExport"]> {
  return {
    getProjectRoot(): string | undefined {
      return deps.getProjectDir();
    },

    async readTimecodes(mediaRefs: string[]): Promise<Map<string, SourceTimecode>> {
      const byPath = new Map<string, string>(); // path -> mediaRef
      for (const ref of mediaRefs) {
        const path = deps.resolvePath(ref);
        if (path) byPath.set(path, ref);
      }
      if (byPath.size === 0) return new Map();

      const probes = await window.desktopMedia.readTimecode([...byPath.keys()]);
      const result = new Map<string, SourceTimecode>();
      for (const [path, ref] of byPath) {
        const probe = probes[path];
        if (!probe) continue;
        const tc = parseTimecodeTag(probe.tag, probe.fps);
        if (tc) result.set(ref, tc);
      }
      return result;
    },

    async saveText(defaultName, contents, kind, outputPath, overwrite = true): Promise<{ path?: string; cancelled?: boolean }> {
      let outPath = outputPath;
      if (!outPath) {
        const picked = await window.desktopProject.pickExportSave(defaultName, KIND_FILTERS[kind]);
        if (!picked) return { cancelled: true };
        outPath = picked;
      } else {
        outPath = normalizeExportOutputPath(outPath, kind);
      }
      const path = await window.desktopProject.writeExportText(outPath, contents, overwrite);
      return { path };
    },
  };
}
