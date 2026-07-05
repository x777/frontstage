import type { SourceTimecode } from "@frontstage/core";
import type { ToolContext } from "@frontstage/ai";

export interface WebInteropExportDeps {
  // e2e test seam, mirrors WebExportGateway's pickSaveFile — real usage falls through to
  // showSaveFilePicker.
  pickSaveFile?: (suggestedName: string, accept: Record<string, string[]>) => Promise<FileSystemFileHandle | null>;
}

type ExportKind = "fcpxml" | "xmeml" | "srt" | "vtt";

const ACCEPT: Record<ExportKind, Record<string, string[]>> = {
  fcpxml: { "application/xml": [".fcpxml"] },
  xmeml: { "application/xml": [".xml"] },
  srt: { "application/x-subrip": [".srt"] },
  vtt: { "text/vtt": [".vtt"] },
};

const DESCRIPTION: Record<ExportKind, string> = {
  fcpxml: "FCPXML timeline",
  xmeml: "XMEML timeline",
  srt: "SubRip subtitles",
  vtt: "WebVTT subtitles",
};

// Web's ToolContext.interopExport facade (M12B T3) — no filesystem access, so readTimecodes always
// resolves empty (the #247 regression-locked 0-based export path); saveText always shows a picker
// regardless of outputPath (browsers don't grant arbitrary-path writes). getProjectRoot is
// intentionally omitted — exporters fall back to the best-effort <projectName>-based path.
export function createWebInteropExport(deps: WebInteropExportDeps = {}): NonNullable<ToolContext["interopExport"]> {
  return {
    async readTimecodes(): Promise<Map<string, SourceTimecode>> {
      return new Map();
    },

    async saveText(defaultName, contents, kind): Promise<{ path?: string; cancelled?: boolean }> {
      try {
        let handle: FileSystemFileHandle | null;
        if (deps.pickSaveFile) {
          handle = await deps.pickSaveFile(defaultName, ACCEPT[kind]);
        } else {
          handle = await (window as any).showSaveFilePicker({
            suggestedName: defaultName,
            types: [{ description: DESCRIPTION[kind], accept: ACCEPT[kind] }],
          });
        }
        if (!handle) return { cancelled: true };
        const w = await handle.createWritable();
        await w.write(contents);
        await w.close();
        return { path: handle.name };
      } catch (e) {
        if ((e as DOMException).name === "AbortError") return { cancelled: true };
        throw e;
      }
    },
  };
}
