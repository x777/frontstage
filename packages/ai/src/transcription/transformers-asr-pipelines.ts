// The real whisper loader (transformers.js/ONNX). Kept out of local-asr.ts and behind a dynamic
// import() so @huggingface/transformers never loads into a test run or an idle host (the M12C rule).
//
// Model verification (M14A T2, 2026-07): onnx-community/whisper-base's config.json has model_type
// "whisper" and max_source_positions 1500, matching the exact shape AutomaticSpeechRecognitionPipeline
// expects for its whisper branch (_call_whisper reads processor.feature_extractor.config.chunk_length /
// model.config.max_source_positions for time_precision). Its onnx/ subfolder ships an
// encoder_model_quantized.onnx + decoder_model_merged_quantized.onnx pair, i.e. dtype: "q8" (which
// DEFAULT_DTYPE_SUFFIX_MAPPING resolves to the "_quantized" suffix for every session file when passed
// as a single string) is a valid, present artifact — verified against the installed
// @huggingface/transformers@3.8.1 source (src/pipelines.js, src/models.js, src/utils/dtypes.js), not memory.
//
// API verified in the same source: `pipeline('automatic-speech-recognition', MODEL_ID, {dtype, device,
// progress_callback})` returns a callable; calling it with `{ return_timestamps: 'word', chunk_length_s,
// stride_length_s, language }` makes WhisperTokenizer._decode_asr emit ALREADY word-segmented
// `chunks: [{ text, timestamp: [start, end] }]` (one chunk per word, via collateWordTimestamps) — no
// fal-style multi-token-per-chunk fallback needed here, unlike whisper-wire.ts's fal mapping.
import type { LocalAsrInfo, LocalAsrPipelines, LocalAsrProgress, RawLocalWord } from "./local-asr.js";

const MODEL_ID = "onnx-community/whisper-base";
const CHUNK_LENGTH_S = 30; // whisper's own encoder window; chunks longer audio instead of truncating it
const STRIDE_LENGTH_S = 5;

export const TRANSFORMERS_ASR_INFO: LocalAsrInfo = {
  model: "whisper-base",
  modelVersion: MODEL_ID,
};

function hasWebGPU(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

interface RawProgressInfo {
  status: string;
  loaded?: number;
  total?: number;
}

function toReportedProgress(info: RawProgressInfo): LocalAsrProgress | null {
  if (typeof info.loaded !== "number" || typeof info.total !== "number") return null;
  return { loaded: info.loaded, total: info.total };
}

interface AsrChunk {
  text: string;
  timestamp: [number | null, number | null];
}

interface AsrOutput {
  text: string;
  chunks?: AsrChunk[];
}

function toWords(chunks: AsrChunk[]): RawLocalWord[] {
  const words: RawLocalWord[] = [];
  for (const chunk of chunks) {
    const text = chunk.text.trim();
    if (text.length === 0) continue;
    const [start, end] = chunk.timestamp;
    words.push({ text, start: start ?? undefined, end: end ?? undefined });
  }
  return words;
}

/**
 * Loads the whisper ASR pipeline. Tries WebGPU first (when the browser advertises it), falling back
 * to WASM on any load failure — same fallback contract as the SigLIP2 loader (transformers-pipelines.ts).
 */
export async function loadTransformersAsrPipelines(onProgress?: (p: LocalAsrProgress) => void): Promise<LocalAsrPipelines> {
  const { pipeline } = await import("@huggingface/transformers");

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
      const transcriber = await pipeline("automatic-speech-recognition", MODEL_ID, { dtype: "q8", device, progress_callback });

      return {
        async transcribe(pcm, sampleRate, language) {
          void sampleRate; // always LOCAL_ASR_SAMPLE_RATE — the processor's fixed feature-extractor rate
          const output = (await transcriber(pcm, {
            return_timestamps: "word",
            chunk_length_s: CHUNK_LENGTH_S,
            stride_length_s: STRIDE_LENGTH_S,
            language,
          })) as AsrOutput | AsrOutput[];
          const single = Array.isArray(output) ? output[0]! : output;
          return { text: single.text, language, words: toWords(single.chunks ?? []) };
        },
      };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export function createTransformersAsrPipelines(): {
  loadPipelines: (onProgress?: (p: LocalAsrProgress) => void) => Promise<LocalAsrPipelines>;
  info: LocalAsrInfo;
} {
  return { loadPipelines: loadTransformersAsrPipelines, info: TRANSFORMERS_ASR_INFO };
}
