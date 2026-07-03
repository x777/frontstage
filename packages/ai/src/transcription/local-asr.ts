// In-browser whisper ASR runtime seam, mirroring EmbeddingService (M12C) exactly: an injectable
// LocalAsrPipelines so tests never touch transformers.js/ONNX; createTransformersAsrPipelines
// (transformers-asr-pipelines.ts) is the real loader, imported lazily.
import type { TranscriptionResult, TranscriptionSegment, TranscriptionWord } from "@palmier/core";
import { deriveSegments } from "../generation/whisper-wire.js";

// The M11A extraction always yields mono 16kHz WAV (encodeWavPcm16Mono's fixed target) — a literal
// type so a caller can't accidentally thread a different sample rate through the pipeline seam.
export const LOCAL_ASR_SAMPLE_RATE = 16000;

export interface RawLocalWord {
  text: string;
  start?: number;
  end?: number;
}

/** What a pipeline hands back before LocalAsrService maps it into the one TranscriptionResult shape. */
export interface RawLocalTranscript {
  text: string;
  language?: string;
  words: RawLocalWord[];
  segments?: TranscriptionSegment[];
}

export interface LocalAsrPipelines {
  transcribe(pcm: Float32Array, sampleRate: typeof LOCAL_ASR_SAMPLE_RATE, language?: string): Promise<RawLocalTranscript>;
}

export interface LocalAsrInfo {
  model: string;
  modelVersion: string;
}

export interface LocalAsrProgress {
  loaded: number;
  total: number;
}

export type LocalAsrState = "idle" | "downloading" | "ready" | "failed";

export interface LocalAsrServiceDeps {
  loadPipelines: (onProgress?: (p: LocalAsrProgress) => void) => Promise<LocalAsrPipelines>;
  info: LocalAsrInfo;
}

export class LocalAsrService {
  readonly info: LocalAsrInfo;
  private readonly loadPipelinesFn: LocalAsrServiceDeps["loadPipelines"];
  private _state: LocalAsrState = "idle";
  private pipelines: LocalAsrPipelines | null = null;
  private inFlight: Promise<void> | null = null;
  private listeners: Array<(p: LocalAsrProgress) => void> = [];

  constructor(deps: LocalAsrServiceDeps) {
    this.loadPipelinesFn = deps.loadPipelines;
    this.info = deps.info;
  }

  get state(): LocalAsrState {
    return this._state;
  }

  /** Idempotent single-flight download/init. Concurrent callers share one load; failed -> next call retries. */
  ensureReady(onProgress?: (p: LocalAsrProgress) => void): Promise<void> {
    if (this._state === "ready") return Promise.resolve();
    if (onProgress) this.listeners.push(onProgress);
    if (this.inFlight) return this.inFlight;

    this._state = "downloading";
    const broadcast = (p: LocalAsrProgress) => {
      for (const listener of this.listeners) listener(p);
    };
    this.inFlight = this.loadPipelinesFn(broadcast)
      .then((pipelines) => {
        this.pipelines = pipelines;
        this._state = "ready";
      })
      .catch((err: unknown) => {
        this._state = "failed";
        throw err;
      })
      .finally(() => {
        this.inFlight = null;
        this.listeners = [];
      });
    return this.inFlight;
  }

  async transcribe(pcm: Float32Array, language?: string): Promise<TranscriptionResult> {
    const pipelines = this.requirePipelines();
    const raw = await pipelines.transcribe(pcm, LOCAL_ASR_SAMPLE_RATE, language);
    const words: TranscriptionWord[] = raw.words.map((w) => ({ text: w.text, start: w.start, end: w.end }));
    const segments = raw.segments ?? deriveSegments(words);
    return { text: raw.text, language: raw.language, words, segments };
  }

  private requirePipelines(): LocalAsrPipelines {
    if (!this.pipelines) throw new Error("LocalAsrService: call ensureReady() before transcribing");
    return this.pipelines;
  }
}
