import type { MediaManifestEntry, TranscriptionResult, TranscriptRecord } from "@frontstage/core";
import { parseTranscriptRecord, serializeGenerationStatus, transcriptRelativePath } from "@frontstage/core";
// Deep import (not the package barrel): the barrel re-exports the WebGPU renderer, which needs DOM
// lib types ai's tsconfig deliberately omits (ai stays host-agnostic/Node-safe).
import { decodeWavPcm16Mono } from "@frontstage/engine/audio/wav-encode.js";
import type { GenJobGateway } from "../generation/gen-gateway.js";
import { nextPollDelay } from "../generation/poll-schedule.js";
import { genModel } from "../generation/gen-catalog.js";
import { estimateCredits } from "../generation/cost-estimator.js";
import { parseWhisperResult } from "../generation/whisper-wire.js";
import { LOCAL_ASR_SAMPLE_RATE, type LocalAsrService } from "./local-asr.js";

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
  // The keyless-fallback / always-free-background provider (M14A). Absent = fal-only, matching pre-M14A behavior.
  local?: LocalAsrService;
}

export interface TranscribeOptions {
  language?: string;
  // The background sweep's path: never touch fal even when keyed (never spends credits).
  forceLocal?: boolean;
}

const WHISPER_ENDPOINT = "fal-ai/whisper";

// Exported so the tools' pre-gates (transcription-tools.ts, caption-tools.ts) surface the exact
// same copy the service itself throws on a keyless+not-ready race — one message, one place.
export const LOCAL_MODEL_UNAVAILABLE_MESSAGE =
  "No fal.ai API key configured. Add one in Settings to transcribe, or download the local transcription model.";

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

// Swift ports Transcription.audioExtractionGate (AsyncSemaphore(value: 2)): bounds only the
// extraction step, not cache hits or gateway calls, so cheap cache-served refs never queue.
const AUDIO_EXTRACTION_CONCURRENCY = 2;

class ExtractionGate {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= AUDIO_EXTRACTION_CONCURRENCY) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
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
  private readonly extractionGate = new ExtractionGate();
  private readonly local?: LocalAsrService;

  constructor(gateway: GenJobGateway, host: TranscriptionHost, extract: AudioExtractor, opts?: TranscriptionServiceOptions) {
    this.gateway = gateway;
    this.host = host;
    this.extract = extract;
    this.sleep = opts?.sleep ?? defaultSleep;
    this.pollDelay = opts?.pollDelay ?? nextPollDelay;
    this.local = opts?.local;
  }

  async transcribe(mediaRef: string, opts?: TranscribeOptions): Promise<TranscriptionResult> {
    const key = `${mediaRef}|${opts?.language ?? ""}`;
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const task = this.run(mediaRef, opts).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, task);
    return task;
  }

  async transcribeMany(
    refs: string[],
    opts?: TranscribeOptions,
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

  private async run(mediaRef: string, opts?: TranscribeOptions): Promise<TranscriptionResult> {
    const language = opts?.language;
    const forceLocal = opts?.forceLocal ?? false;
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
      // forceLocal short-circuits before hasKey() is ever evaluated — the background path must
      // never touch fal, not even to check for a key. A rejecting hasKey (M10 rule) means "no
      // key" — falls to local/keyless, not a hard failure of an otherwise-keyed run.
      const useFal = !forceLocal && (await this.gateway.hasKey().catch(() => false));
      const { parsed, durationSeconds, provider, model } = useFal
        ? await this.runFal(mediaRef, language)
        : await this.runLocal(mediaRef, language);

      if (language === undefined) {
        const record: TranscriptRecord = { ...parsed, sourceDurationSeconds: durationSeconds, model, provider };
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

  private async runFal(
    mediaRef: string,
    language: string | undefined,
  ): Promise<{ parsed: TranscriptionResult; durationSeconds: number; provider: "fal"; model: string }> {
    const { wav, durationSeconds } = await this.extractionGate.run(() => this.extract(mediaRef));
    const url = await this.gateway.uploadFile(wav, "audio/wav", `${mediaRef}.wav`);
    const whisper = requireWhisperEntry();
    const input = whisper.buildInput({ sourceUrl: url, language });
    const { jobId } = await this.gateway.submitJob(WHISPER_ENDPOINT, input);
    const resultJson = await this.poll(jobId);
    const parsed = parseWhisperResult(resultJson);
    return { parsed, durationSeconds, provider: "fal", model: WHISPER_ENDPOINT };
  }

  private async runLocal(
    mediaRef: string,
    language: string | undefined,
  ): Promise<{ parsed: TranscriptionResult; durationSeconds: number; provider: "local"; model: string }> {
    if (!this.local || this.local.state !== "ready") {
      // NO auto-download here — the model gate (T3) owns triggering ensureReady().
      throw new Error(LOCAL_MODEL_UNAVAILABLE_MESSAGE);
    }
    const local = this.local;
    const { wav, durationSeconds } = await this.extractionGate.run(() => this.extract(mediaRef));
    const decoded = decodeWavPcm16Mono(wav);
    if (decoded.sampleRate !== LOCAL_ASR_SAMPLE_RATE) {
      throw new Error(`local transcription expects ${LOCAL_ASR_SAMPLE_RATE}Hz audio, got ${decoded.sampleRate}Hz`);
    }
    const parsed = await local.transcribe(decoded.samples, language);
    return { parsed, durationSeconds, provider: "local", model: local.info.modelVersion };
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
