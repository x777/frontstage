import { runExport } from "@palmier/engine";
import type { Timeline } from "@palmier/core";
import type { MediaByteSource } from "@palmier/engine";
import type { ExportGateway, ExportTarget, ExportProgressFn } from "@palmier/ui";
import { FfmpegIpcSink } from "./ffmpeg-sink.js";

interface DesktopExportTarget extends ExportTarget {
  outPath: string;
  codec: string;
}

export class DesktopExportGateway implements ExportGateway {
  async pickTarget(suggestedName: string): Promise<ExportTarget | null> {
    const p = await window.desktopProject.pickExportSave(suggestedName + ".mp4");
    if (!p) return null;
    const codec = p.toLowerCase().endsWith(".mov") ? "prores_ks" : "libx264";
    const label = p.split(/[/\\]/).pop()!;
    const target: DesktopExportTarget = { label, outPath: p, codec };
    return target;
  }

  async run(
    timeline: Timeline,
    media: MediaByteSource,
    target: ExportTarget,
    onProgress: ExportProgressFn,
  ): Promise<void> {
    const t = target as DesktopExportTarget;
    await runExport(
      timeline,
      media,
      new FfmpegIpcSink(window.desktopExport, { codec: t.codec, outPath: t.outPath }),
      onProgress,
    );
  }
}
