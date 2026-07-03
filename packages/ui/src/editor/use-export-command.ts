import { useRef, useState } from "react";
import type { MediaManifestEntry, Timeline } from "@palmier/core";
import { cuesFromCaptionClips, exportFcpxml, exportXmeml, formatSrt, formatVtt, timelineMediaRefs } from "@palmier/core";
import type { MediaByteSource } from "@palmier/engine";
import type { ToolContext } from "@palmier/ai";
import type { ExportGateway } from "./export-gateway.js";
import type { RunProjectCommand } from "./Editor.js";

export type ExportKind = "video" | "fcpxml" | "xmeml" | "srt" | "vtt";

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
}): {
  exportProject: (kind?: ExportKind) => void;
  exportState: ExportState | null;
  canExport: boolean;
  canExportXml: boolean;
  canExportCaptions: boolean;
} {
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
        const projectRoot = interopExport.getProjectRoot?.();
        const xml =
          kind === "xmeml"
            ? exportXmeml(timeline, entries, { projectRoot, projectName, startTimecodes })
            : exportFcpxml(timeline, entries, { projectRoot, projectName, startTimecodes });
        const ext = kind === "xmeml" ? "xml" : "fcpxml";
        await interopExport.saveText(`${projectName}.${ext}`, xml, kind, undefined, true);
      } finally {
        runningRef.current = false;
      }
    });
  }

  // srt/vtt (M14A T1): the timeline-caption-clips path only — the cached-transcript path is
  // tool-only (export_project's captionsSource.mediaRef), not reachable from this picker.
  function exportCaptions(kind: "srt" | "vtt") {
    if (!interopExport) return;
    runningRef.current = true;
    runProjectCommand(async () => {
      try {
        const timeline = getTimeline();
        const cues = cuesFromCaptionClips(timeline, timeline.fps);
        // No-op rather than saving an empty subtitle file — the picker only shows these buttons when
        // canExportCaptions is true, but the native (macOS) Export menu can't express that gating.
        if (cues.length === 0) return;
        const contents = kind === "srt" ? formatSrt(cues) : formatVtt(cues);
        await interopExport.saveText(`${suggestedName()}.${kind}`, contents, kind, undefined, true);
      } finally {
        runningRef.current = false;
      }
    });
  }

  function exportProject(kind: ExportKind = "video") {
    if (runningRef.current) return;
    if (kind === "video") exportVideo();
    else if (kind === "fcpxml" || kind === "xmeml") exportXml(kind);
    else exportCaptions(kind);
  }

  const currentTimeline = getTimeline();
  const canExportCaptions = !!interopExport && cuesFromCaptionClips(currentTimeline, currentTimeline.fps).length > 0;

  return { exportProject, exportState, canExport: !!exportGateway, canExportXml: !!interopExport, canExportCaptions };
}
