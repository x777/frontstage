import { useRef, useState } from "react";
import type { Timeline } from "@palmier/core";
import type { MediaByteSource } from "@palmier/engine";
import type { ExportGateway } from "./export-gateway.js";
import type { RunProjectCommand } from "./Editor.js";

export interface ExportState {
  label: string;
  done: number;
  total: number;
}

export function useExportCommand(opts: {
  exportGateway?: ExportGateway;
  getTimeline: () => Timeline;
  media: MediaByteSource;
  suggestedName: () => string;
  runProjectCommand: RunProjectCommand;
}): { exportProject: () => void; exportState: ExportState | null; canExport: boolean } {
  const { exportGateway, getTimeline, media, suggestedName, runProjectCommand } = opts;
  const [exportState, setExportState] = useState<ExportState | null>(null);
  // Sync re-entrancy guard: state update is async, so we need a ref too.
  const runningRef = useRef(false);

  function exportProject() {
    if (!exportGateway || runningRef.current) return;
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

  return { exportProject, exportState, canExport: !!exportGateway };
}
