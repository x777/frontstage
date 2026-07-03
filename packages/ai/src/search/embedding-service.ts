// SigLIP embedding runtime seam. `EmbeddingPipelines` is injected so tests never touch
// transformers.js/ONNX; `createTransformersPipelines` (transformers-pipelines.ts) is the real loader.
// Normalization: Swift's VisualEmbedder never calls an explicit normalize step, but the T1 ranker
// (visual-rank.ts) is a plain dot product documented as scoring "unit-normalized embeddings" — the
// Swift CoreML graphs bake L2-normalization into the combined SiglipModel export. transformers.js's
// per-modality SiglipTextModel/SiglipVisionModel return raw (unnormalized) pooler_output, so this
// service normalizes on every embed call to guarantee the dot-product ranker sees unit vectors
// regardless of what a given pipeline implementation returns.

export interface EmbeddingPipelines {
  embedImage(rgba: Uint8ClampedArray, width: number, height: number): Promise<Float32Array>;
  embedText(text: string): Promise<Float32Array>;
}

export interface EmbeddingModelInfo {
  model: string;
  modelVersion: string;
  dim: number;
}

export interface EmbeddingProgress {
  loaded: number;
  total: number;
}

export type EmbeddingState = "idle" | "downloading" | "ready" | "failed";

export interface EmbeddingServiceDeps {
  loadPipelines: (onProgress?: (p: EmbeddingProgress) => void) => Promise<EmbeddingPipelines>;
  info: EmbeddingModelInfo;
}

// Swift SearchIndexConfig.manifest.imageSize — the frame tap (T3) squash-resizes before calling in.
const IMAGE_SIZE = 256;

export class EmbeddingService {
  readonly info: EmbeddingModelInfo;
  private readonly loadPipelinesFn: EmbeddingServiceDeps["loadPipelines"];
  private _state: EmbeddingState = "idle";
  private pipelines: EmbeddingPipelines | null = null;
  private inFlight: Promise<void> | null = null;
  private listeners: Array<(p: EmbeddingProgress) => void> = [];

  constructor(deps: EmbeddingServiceDeps) {
    this.loadPipelinesFn = deps.loadPipelines;
    this.info = deps.info;
  }

  get state(): EmbeddingState {
    return this._state;
  }

  /** Idempotent single-flight download/init. Concurrent callers share one load; failed -> next call retries. */
  ensureReady(onProgress?: (p: EmbeddingProgress) => void): Promise<void> {
    if (this._state === "ready") return Promise.resolve();
    if (onProgress) this.listeners.push(onProgress);
    if (this.inFlight) return this.inFlight;

    this._state = "downloading";
    const broadcast = (p: EmbeddingProgress) => {
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

  async embedImage(rgba: Uint8ClampedArray, width: number, height: number): Promise<Float32Array> {
    if (width !== IMAGE_SIZE || height !== IMAGE_SIZE) {
      throw new Error(`embedImage expects a pre-squashed ${IMAGE_SIZE}x${IMAGE_SIZE} frame, got ${width}x${height}`);
    }
    const pipelines = this.requirePipelines();
    return this.normalized(await pipelines.embedImage(rgba, width, height));
  }

  async embedText(text: string): Promise<Float32Array> {
    const pipelines = this.requirePipelines();
    return this.normalized(await pipelines.embedText(text));
  }

  private requirePipelines(): EmbeddingPipelines {
    if (!this.pipelines) throw new Error("EmbeddingService: call ensureReady() before embedding");
    return this.pipelines;
  }

  private normalized(vector: Float32Array): Float32Array {
    if (vector.length !== this.info.dim) {
      throw new Error(`embedding pipeline returned dim ${vector.length}, expected ${this.info.dim}`);
    }
    let sumSq = 0;
    for (let i = 0; i < vector.length; i++) sumSq += vector[i]! * vector[i]!;
    const norm = Math.sqrt(sumSq);
    if (norm === 0) return vector;
    const out = new Float32Array(vector.length);
    for (let i = 0; i < vector.length; i++) out[i] = vector[i]! / norm;
    return out;
  }
}
