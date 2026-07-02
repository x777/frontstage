import type { MediaManifestEntry, TranscriptionResult, TranscriptRecord } from "@palmier/core";
import { parseTranscriptRecord, serializeGenerationStatus, transcriptRelativePath } from "@palmier/core";
import type { GenJobGateway } from "../generation/gen-gateway.js";
import { nextPollDelay } from "../generation/poll-schedule.js";
import { genModel } from "../generation/gen-catalog.js";
import { estimateCredits } from "../generation/cost-estimator.js";
import { parseWhisperResult } from "../generation/whisper-wire.js";

export type AudioExtractor = (mediaRef: string) => Promise<{ wav: Uint8Array; durationSeconds: number }>;

export interface TranscriptionHost {
  entries(): MediaManifestEntry[];
  patchEntry(id: string, patch: Partial<MediaManifestEntry>): void;
  // Rides the library's pending-persist bytes flow (see MediaLibrary._bytes) — emits on write.
  writeDerived(relativePath: string, bytes: Uint8Array): void;
  // In-memory bytes for the path if still held, else the project's media gateway; null on either miss.
  readDerived(relativePath: string): Promise<Uint8Array | null>;
}

export interface TranscriptionServiceOptions {
  sleep?: (ms: number) => Promise<void>;
  pollDelay?: typeof nextPollDelay;
}

const WHISPER_ENDPOINT = "fal-ai/whisper";

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireWhisperEntry() {
  const entry = genModel("whisper");
  if (!entry) throw new Error("whisper catalog entry missing");
  return entry;
}

/** Cache-first, full-file (the #232 invariant), parallel transcription orchestration over fal-ai/whisper. */
export class TranscriptionService {
  private readonly gateway: GenJobGateway;
  private readonly host: TranscriptionHost;
  private readonly extract: AudioExtractor;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly pollDelay: typeof nextPollDelay;
  // Keyed by mediaRef + language override so two concurrent SAME-language calls share one
  // extract/upload/submit, without silently merging two different forced-language requests.
  private readonly inFlight = new Map<string, Promise<TranscriptionResult>>();

  constructor(gateway: GenJobGateway, host: TranscriptionHost, extract: AudioExtractor, opts?: TranscriptionServiceOptions) {
    this.gateway = gateway;
    this.host = host;
    this.extract = extract;
    this.sleep = opts?.sleep ?? defaultSleep;
    this.pollDelay = opts?.pollDelay ?? nextPollDelay;
  }

  async transcribe(mediaRef: string, opts?: { language?: string }): Promise<TranscriptionResult> {
    const key = `${mediaRef}|${opts?.language ?? ""}`;
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const task = this.run(mediaRef, opts).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, task);
    return task;
  }

  async transcribeMany(
    refs: string[],
    opts?: { language?: string },
  ): Promise<{ ref: string; result?: TranscriptionResult; error?: string }[]> {
    const unique = [...new Set(refs)];
    return Promise.all(
      unique.map(async (ref) => {
        try {
          const result = await this.transcribe(ref, opts);
          return { ref, result };
        } catch (err) {
          return { ref, error: toMessage(err) };
        }
      }),
    );
  }

  /** Cache-only read: returns the cached full result, or null on a miss/corrupt cache. Never transcribes. */
  async cachedTranscript(mediaRef: string): Promise<TranscriptionResult | null> {
    const entry = this.host.entries().find((e) => e.id === mediaRef);
    if (!entry?.transcriptPath) return null;
    return this.readCache(entry.transcriptPath);
  }

  estimateCredits(durationSeconds: number): number {
    return estimateCredits(requireWhisperEntry(), { duration: durationSeconds });
  }

  hasKey(): Promise<boolean> {
    return this.gateway.hasKey();
  }

  private async run(mediaRef: string, opts?: { language?: string }): Promise<TranscriptionResult> {
    const language = opts?.language;
    const entry = this.host.entries().find((e) => e.id === mediaRef);
    if (!entry) throw new Error("media not found: " + mediaRef);

    // A language override BYPASSES the cache entirely — no read, no write (preserves the
    // auto-detected cached entry for un-overridden callers, matching Swift).
    if (language === undefined && entry.transcriptPath) {
      const cached = await this.readCache(entry.transcriptPath);
      if (cached) return cached;
    }

    this.host.patchEntry(mediaRef, { generationStatus: serializeGenerationStatus({ kind: "transcribing" }) });

    try {
      const { wav, durationSeconds } = await this.extract(mediaRef);
      const url = await this.gateway.uploadFile(wav, "audio/wav", `${mediaRef}.wav`);
      const whisper = requireWhisperEntry();
      const input = whisper.buildInput({ sourceUrl: url, language });
      const { jobId } = await this.gateway.submitJob(WHISPER_ENDPOINT, input);
      const resultJson = await this.poll(jobId);
      const parsed = parseWhisperResult(resultJson);

      if (language === undefined) {
        const record: TranscriptRecord = { ...parsed, sourceDurationSeconds: durationSeconds, model: WHISPER_ENDPOINT };
        const relativePath = transcriptRelativePath(mediaRef);
        this.host.writeDerived(relativePath, new TextEncoder().encode(JSON.stringify(record)));
        this.host.patchEntry(mediaRef, { transcriptPath: relativePath, generationStatus: undefined });
      } else {
        this.host.patchEntry(mediaRef, { generationStatus: undefined });
      }

      return parsed;
    } catch (err) {
      const message = toMessage(err);
      this.host.patchEntry(mediaRef, { generationStatus: serializeGenerationStatus({ kind: "failed", message }) });
      throw err;
    }
  }

  private async readCache(relativePath: string): Promise<TranscriptionResult | null> {
    const bytes = await this.host.readDerived(relativePath);
    if (!bytes) return null;
    const record = parseTranscriptRecord(new TextDecoder().decode(bytes));
    if (!record) return null;
    return { text: record.text, language: record.language, words: record.words, segments: record.segments };
  }

  private async poll(jobId: string): Promise<unknown> {
    let delay: number | undefined;
    for (;;) {
      delay = this.pollDelay(delay);
      await this.sleep(delay);

      const status = await this.gateway.jobStatus(WHISPER_ENDPOINT, jobId);
      if (status.status === "queued" || status.status === "running") continue;
      if (status.status === "failed") throw new Error(status.errorMessage ?? "Transcription failed");
      if (status.resultJson === undefined) throw new Error("whisper job succeeded with no result payload");
      return status.resultJson;
    }
  }
}
