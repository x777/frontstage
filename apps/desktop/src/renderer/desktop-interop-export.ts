import { parseTimecodeTag, type SourceTimecode } from "@palmier/core";
import type { ToolContext } from "@palmier/ai";
import type { ExportSaveFilter } from "./desktop-gateway.js";

export interface DesktopInteropExportDeps {
  // Resolves a mediaRef to an on-disk absolute path, or null if it isn't resolvable (in-memory-only
  // media, missing project, etc.) — mirrors the audio extractor's resolvePath.
  resolvePath(mediaRef: string): string | null;
}

const KIND_FILTERS: Record<"fcpxml" | "xmeml", ExportSaveFilter> = {
  fcpxml: { name: "FCPXML", extensions: ["fcpxml"] },
  xmeml: { name: "XMEML", extensions: ["xml"] },
};

function extensionForKind(kind: "fcpxml" | "xmeml"): string {
  return kind === "xmeml" ? "xml" : "fcpxml";
}

export function createDesktopInteropExport(deps: DesktopInteropExportDeps): NonNullable<ToolContext["interopExport"]> {
  return {
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
        const rawExt = outPath.split(".").pop()?.toLowerCase();
        const expectedExt = extensionForKind(kind);
        if (rawExt !== expectedExt) outPath = `${outPath}.${expectedExt}`;
      }
      const path = await window.desktopProject.writeExportText(outPath, contents, overwrite);
      return { path };
    },
  };
}
