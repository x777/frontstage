import type { GenerationInput, GenerationLogEntry, MediaManifestEntry } from "@palmier/core";
import { scanResumableGenerations, serializeGenerationStatus } from "@palmier/core";
import type { GenJobGateway } from "./gen-gateway.js";
import { nextPollDelay } from "./poll-schedule.js";

export interface GenerationHost {
  addPlaceholder(entry: MediaManifestEntry): void;
  patchEntry(id: string, patch: Partial<MediaManifestEntry>): void;
  finalizeGenerated(id: string, bytes: Uint8Array, patch: Partial<MediaManifestEntry>): void;
  markGenerationFailed(ids: string[], message: string): void;
  entries(): MediaManifestEntry[];
  appendGenerationLog?(entry: GenerationLogEntry): void;
  requestCheckpoint?(): void;
  notifyComplete?(assetName: string): void;
}

export interface GenerationServiceOptions {
  pollDelay?: typeof nextPollDelay;
  sleep?: (ms: number) => Promise<void>;
}

export interface StartJobArgs {
  modelEndpoint: string;
  input: Record<string, unknown>;
  placeholders: MediaManifestEntry[];
  model: string;
  costCredits?: number | null;
}

/** A submitted (or resumed) backend job and the placeholders it will finalize. */
interface JobGroup {
  jobId: string;
  modelEndpoint: string;
  placeholders: MediaManifestEntry[];
  model: string;
  costCredits: number | null;
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Renderer-resident orchestrator: submit -> poll -> download -> finalize -> log -> notify. Port of Swift's GenerationService. */
export class GenerationService {
  private readonly gateway: GenJobGateway;
  private readonly host: GenerationHost;
  private readonly pollDelay: typeof nextPollDelay;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly active = new Map<string, JobGroup>();

  constructor(gateway: GenJobGateway, host: GenerationHost, opts?: GenerationServiceOptions) {
    this.gateway = gateway;
    this.host = host;
    this.pollDelay = opts?.pollDelay ?? nextPollDelay;
    this.sleep = opts?.sleep ?? defaultSleep;
  }

  async startJob(args: StartJobArgs): Promise<{ jobId: string } | { error: string }> {
    let jobId: string;
    try {
      const submitted = await this.gateway.submitJob(args.modelEndpoint, args.input);
      jobId = submitted.jobId;
    } catch (err) {
      const message = toMessage(err);
      this.host.markGenerationFailed(
        args.placeholders.map((p) => p.id),
        message,
      );
      return { error: message };
    }

    for (const placeholder of args.placeholders) {
      this.host.patchEntry(placeholder.id, {
        generationInput: { ...(placeholder.generationInput as GenerationInput), backendJobId: jobId },
        generationStatus: serializeGenerationStatus({ kind: "generating" }),
      });
    }
    this.host.requestCheckpoint?.();

    const group: JobGroup = {
      jobId,
      modelEndpoint: args.modelEndpoint,
      placeholders: args.placeholders,
      model: args.model,
      costCredits: args.costCredits ?? null,
    };
    this.active.set(jobId, group);
    void this.pollLoop(group);

    return { jobId };
  }

  async retryDownload(entryId: string): Promise<boolean> {
    const entry = this.host.entries().find((e) => e.id === entryId);
    const resultURLs = entry?.generationInput?.resultURLs;
    if (!entry || !resultURLs) return false;
    const outputIndex = entry.generationInput?.outputIndex ?? 0;
    const url = resultURLs[outputIndex];
    if (!url) return false;

    this.host.patchEntry(entryId, { generationStatus: serializeGenerationStatus({ kind: "downloading" }) });
    return this.downloadAndFinalize(entryId, url, entry.generationInput?.model ?? "", null);
  }

  /** Re-enters resumable jobs after a project (re)open. Skips jobIds already being handled by this instance. */
  resumePending(): void {
    const jobs = scanResumableGenerations(this.host.entries());
    for (const job of jobs) {
      if (this.active.has(job.backendJobId)) continue;

      const inFlight: MediaManifestEntry[] = [];
      for (const entry of job.entries) {
        if ((entry.generationInput?.resultURLs?.length ?? 0) > 0) {
          void this.retryDownload(entry.id);
        } else {
          inFlight.push(entry);
        }
      }
      if (inFlight.length === 0) continue;

      const modelEndpoint = inFlight[0]!.generationInput!.model;
      const group: JobGroup = {
        jobId: job.backendJobId,
        modelEndpoint,
        placeholders: inFlight,
        model: modelEndpoint,
        costCredits: null,
      };
      this.active.set(job.backendJobId, group);
      void this.pollLoop(group);
    }
  }

  /** Stops every in-flight poll loop; loops check membership after each sleep and exit silently once removed. */
  dispose(): void {
    this.active.clear();
  }

  private async pollLoop(group: JobGroup): Promise<void> {
    try {
      let delay: number | undefined;
      for (;;) {
        delay = this.pollDelay(delay);
        await this.sleep(delay);
        if (!this.active.has(group.jobId)) return;

        const status = await this.gateway.jobStatus(group.modelEndpoint, group.jobId);

        if (status.status === "queued" || status.status === "running") continue;

        if (status.status === "failed") {
          this.host.markGenerationFailed(
            group.placeholders.map((p) => p.id),
            status.errorMessage ?? "Generation failed",
          );
          this.host.requestCheckpoint?.();
          return;
        }

        await this.finalizeSucceeded(group, status.resultUrls ?? []);
        return;
      }
    } catch (err) {
      this.host.markGenerationFailed(
        group.placeholders.map((p) => p.id),
        toMessage(err),
      );
    } finally {
      this.active.delete(group.jobId);
    }
  }

  private async finalizeSucceeded(group: JobGroup, resultUrls: string[]): Promise<void> {
    let firstFinalizedName: string | undefined;

    for (const placeholder of group.placeholders) {
      const outputIndex = placeholder.generationInput?.outputIndex ?? 0;
      const url = resultUrls[outputIndex];
      if (!url) {
        this.host.markGenerationFailed([placeholder.id], "No URL for placeholder");
        continue;
      }

      // Re-read from the host: it may hold a fresher generationInput (e.g. the backendJobId stamped at submit time).
      const current = this.host.entries().find((e) => e.id === placeholder.id);
      this.host.patchEntry(placeholder.id, {
        generationStatus: serializeGenerationStatus({ kind: "downloading" }),
        generationInput: { ...(current?.generationInput ?? (placeholder.generationInput as GenerationInput)), resultURLs: resultUrls },
      });

      const ok = await this.downloadAndFinalize(placeholder.id, url, group.model, group.costCredits);
      if (ok && firstFinalizedName === undefined) firstFinalizedName = placeholder.name;
    }

    if (firstFinalizedName !== undefined) this.host.notifyComplete?.(firstFinalizedName);
    this.host.requestCheckpoint?.();
  }

  private async downloadAndFinalize(
    entryId: string,
    url: string,
    model: string,
    costCredits: number | null,
  ): Promise<boolean> {
    try {
      const bytes = await this.gateway.downloadResult(url);
      this.host.finalizeGenerated(entryId, bytes, {});
      this.host.appendGenerationLog?.({ id: entryId, model, costCredits, createdAt: new Date().toISOString() });
      return true;
    } catch (err) {
      this.host.markGenerationFailed([entryId], `Download failed: ${toMessage(err)}`);
      return false;
    }
  }
}
