// The real SigLIP2 loader (transformers.js/ONNX). Kept out of embedding-service.ts and behind a
// dynamic import() so @huggingface/transformers (and its ~100MB+ of weights, fetched lazily by
// from_pretrained) never load into a test run or an idle host.
//
// Model verification (M12C T2): onnx-community/siglip2-base-patch16-256-ONNX is the exact ONNX
// export of google/siglip2-base-patch16-256 (config.json: model_type "siglip", vision_config.image_size
// 256; text/vision pooler dim 768 — matches Swift's SearchIndexConfig.manifest.embeddingDim verbatim,
// no substitution needed). The repo ships separate onnx/text_model*.onnx + onnx/vision_model*.onnx
// weights, which is what lets embedImage/embedText run independently instead of one joint forward pass.
//
// API verified against @huggingface/transformers v3.8.1 source (modeling_siglip.js, dtypes.js,
// devices.js): SiglipTextModel/SiglipVisionModel default their `model_file_name` to "text_model" /
// "vision_model"; `dtype: "q8"` resolves to the "_quantized" file suffix (present for both encoders);
// `device: "webgpu" | "wasm"` picks the ORT execution provider. Their outputs are the model's raw
// pooler_output — SiglipModel (the combined class) is the only one that L2-normalizes, in its own
// forward(), so this loader returns pooler_output UNNORMALIZED; EmbeddingService normalizes centrally.

import type { EmbeddingModelInfo, EmbeddingPipelines, EmbeddingProgress } from "./embedding-service.js";

const MODEL_ID = "onnx-community/siglip2-base-patch16-256-ONNX";
const TEXT_MAX_LENGTH = 64; // Swift SearchIndexConfig.manifest.contextLength — max-length padded, no attention mask

export const TRANSFORMERS_MODEL_INFO: EmbeddingModelInfo = {
  model: "siglip2-base-patch16-256",
  modelVersion: MODEL_ID,
  dim: 768,
};

function hasWebGPU(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

interface RawProgressInfo {
  status: string;
  loaded?: number;
  total?: number;
}

function toReportedProgress(info: RawProgressInfo): EmbeddingProgress | null {
  if (typeof info.loaded !== "number" || typeof info.total !== "number") return null;
  return { loaded: info.loaded, total: info.total };
}

/**
 * Loads the SigLIP2 text + vision encoders. Tries WebGPU first (when the browser advertises it),
 * falling back to WASM on any load failure — including a WebGPU adapter that advertises support but
 * fails to initialize. transformers.js caches downloaded weights via the browser Cache API, so a
 * retry after a fallback re-hits cache instead of re-downloading (progress may briefly "restart" on
 * fallback for whatever wasn't yet cached from the failed attempt).
 */
export async function loadTransformersPipelines(onProgress?: (p: EmbeddingProgress) => void): Promise<EmbeddingPipelines> {
  const { AutoTokenizer, AutoProcessor, SiglipTextModel, SiglipVisionModel, RawImage } = await import("@huggingface/transformers");

  const progress_callback = onProgress
    ? (info: RawProgressInfo) => {
        const reported = toReportedProgress(info);
        if (reported) onProgress(reported);
      }
    : undefined;

  const devices = hasWebGPU() ? (["webgpu", "wasm"] as const) : (["wasm"] as const);

  let lastError: unknown;
  for (const device of devices) {
    try {
      const [tokenizer, processor, textModel, visionModel] = await Promise.all([
        AutoTokenizer.from_pretrained(MODEL_ID),
        AutoProcessor.from_pretrained(MODEL_ID),
        SiglipTextModel.from_pretrained(MODEL_ID, { dtype: "q8", device, progress_callback }),
        SiglipVisionModel.from_pretrained(MODEL_ID, { dtype: "q8", device, progress_callback }),
      ]);

      return {
        async embedImage(rgba, width, height) {
          const image = new RawImage(rgba, width, height, 4);
          const inputs = await processor(image);
          const { pooler_output } = (await visionModel(inputs)) as { pooler_output: { data: Float32Array } };
          return Float32Array.from(pooler_output.data);
        },
        async embedText(text) {
          const inputs = tokenizer([text], { padding: "max_length", truncation: true, max_length: TEXT_MAX_LENGTH });
          const { pooler_output } = (await textModel(inputs)) as { pooler_output: { data: Float32Array } };
          return Float32Array.from(pooler_output.data);
        },
      };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function createTransformersPipelines(): {
  loadPipelines: (onProgress?: (p: EmbeddingProgress) => void) => Promise<EmbeddingPipelines>;
  info: EmbeddingModelInfo;
} {
  return { loadPipelines: loadTransformersPipelines, info: TRANSFORMERS_MODEL_INFO };
}
