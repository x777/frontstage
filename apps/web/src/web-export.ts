import type { ExportGateway, ExportTarget, ExportProgressFn } from "@palmier/ui";
import type { Timeline } from "@palmier/core";
import type { MediaByteSource } from "@palmier/engine";
import { runExport, WebCodecsMp4Sink } from "@palmier/engine";

interface WebExportTarget extends ExportTarget {
  handle: FileSystemFileHandle;
}

export interface WebExportGatewayOptions {
  pickSaveFile?: (suggestedName: string) => Promise<FileSystemFileHandle | null>;
}

export class WebExportGateway implements ExportGateway {
  private readonly opts: WebExportGatewayOptions | undefined;

  constructor(opts?: WebExportGatewayOptions) {
    this.opts = opts;
  }

  async pickTarget(suggestedName: string): Promise<ExportTarget | null> {
    try {
      let handle: FileSystemFileHandle | null;
      if (this.opts?.pickSaveFile) {
        handle = await this.opts.pickSaveFile(suggestedName);
      } else {
        handle = await (window as any).showSaveFilePicker({
          suggestedName: suggestedName + ".mp4",
          types: [{ description: "MP4 video", accept: { "video/mp4": [".mp4"] } }],
        });
      }
      if (!handle) return null;
      return { label: handle.name, handle } as WebExportTarget;
    } catch (e) {
      if ((e as DOMException).name === "AbortError") return null;
      throw e;
    }
  }

  async run(
    timeline: Timeline,
    media: MediaByteSource,
    target: ExportTarget,
    onProgress: ExportProgressFn,
  ): Promise<void> {
    const blob = await runExport(timeline, media, new WebCodecsMp4Sink(), onProgress);
    const w = await (target as WebExportTarget).handle.createWritable();
    await w.write(blob!);
    await w.close();
  }
}
