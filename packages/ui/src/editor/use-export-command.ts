import { useRef, useState } from "react";
import type { MediaManifestEntry, Timeline } from "@palmier/core";
import { exportFcpxml, exportXmeml, timelineMediaRefs } from "@palmier/core";
import type { MediaByteSource } from "@palmier/engine";
import type { ToolContext } from "@palmier/ai";
import type { ExportGateway } from "./export-gateway.js";
import type { RunProjectCommand } from "./Editor.js";

export type ExportKind = "video" | "fcpxml" | "xmeml";

export interface ExportState {
  label: string;
  done: number;
  total: number;
}

export function useExportCommand(opts: {
  exportGateway?: ExportGateway;
  interopExport?: ToolContext["interopExport"];
  getTimeline: () => Timeline;
  getMediaEntries?: () => MediaManifestEntry[];
  media: MediaByteSource;
  suggestedName: () => string;
  runProjectCommand: RunProjectCommand;
}): { exportProject: (kind?: ExportKind) => void; exportState: ExportState | null; canExport: boolean; canExportXml: boolean } {
  const { exportGateway, interopExport, getTimeline, getMediaEntries, media, suggestedName, runProjectCommand } = opts;
  const [exportState, setExportState] = useState<ExportState | null>(null);
  // Sync re-entrancy guard: state update is async, so we need a ref too.
  const runningRef = useRef(false);

  function exportVideo() {
    if (!exportGateway) return;
    runningRef.current = true;
    runProjectCommand(async () => {
      try {
        const t = await exportGateway.pickTarget(suggestedName());
        if (!t) return;
        setExportState({ label: t.label, done: 0, total: 1 });
        try {
          await exportGateway.run(getTimeline(), media, t, (done, total) =>
            setExportState({ label: t.label, done, total })
          );
        } finally {
          setExportState(null);
        }
      } finally {
        runningRef.current = false;
      }
    });
  }

  function exportXml(kind: "fcpxml" | "xmeml") {
    if (!interopExport) return;
    runningRef.current = true;
    runProjectCommand(async () => {
      try {
        const timeline = getTimeline();
        const entries = getMediaEntries?.() ?? [];
        const projectName = suggestedName();
        const startTimecodes = await interopExport.readTimecodes(timelineMediaRefs(timeline));
        const xml =
          kind === "xmeml"
            ? exportXmeml(timeline, entries, { projectName, startTimecodes })
            : exportFcpxml(timeline, entries, { projectName, startTimecodes });
        const ext = kind === "xmeml" ? "xml" : "fcpxml";
        await interopExport.saveText(`${projectName}.${ext}`, xml, kind, undefined, true);
      } finally {
        runningRef.current = false;
      }
    });
  }

  function exportProject(kind: ExportKind = "video") {
    if (runningRef.current) return;
    if (kind === "video") exportVideo();
    else exportXml(kind);
  }

  return { exportProject, exportState, canExport: !!exportGateway, canExportXml: !!interopExport };
}
