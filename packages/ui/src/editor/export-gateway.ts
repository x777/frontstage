import type { Timeline, TimelineResolver } from "@frontstage/core";
import type { MediaByteSource } from "@frontstage/engine";

export interface ExportTarget {
  readonly label: string;
}

export type ExportProgressFn = (completed: number, total: number) => void;

export interface ExportRunOptions {
  resolveTimeline?: TimelineResolver;
}

export interface ExportGateway {
  pickTarget(suggestedName: string): Promise<ExportTarget | null>;
  run(
    timeline: Timeline,
    media: MediaByteSource,
    target: ExportTarget,
    onProgress: ExportProgressFn,
    opts?: ExportRunOptions,
  ): Promise<void>;
}
