// PCM16 mono WAV builder — resamples (linear) to targetRate, clamps to int16, writes a 44-byte RIFF/WAVE header.
// Downmixing is the caller's job; this only ever produces mono output.

const HEADER_BYTES = 44;
const BITS_PER_SAMPLE = 16;
const CHANNELS = 1;

function writeHeader(view: DataView, sampleRate: number, dataSize: number): void {
  let offset = 0;
  const writeStr = (s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
    offset += s.length;
  };
  const byteRate = sampleRate * CHANNELS * (BITS_PER_SAMPLE / 8);
  const blockAlign = CHANNELS * (BITS_PER_SAMPLE / 8);

  writeStr("RIFF");
  view.setUint32(offset, 36 + dataSize, true); offset += 4;
  writeStr("WAVE");
  writeStr("fmt ");
  view.setUint32(offset, 16, true); offset += 4; // fmt chunk size (PCM)
  view.setUint16(offset, 1, true); offset += 2; // audio format: PCM
  view.setUint16(offset, CHANNELS, true); offset += 2;
  view.setUint32(offset, sampleRate, true); offset += 4;
  view.setUint32(offset, byteRate, true); offset += 4;
  view.setUint16(offset, blockAlign, true); offset += 2;
  view.setUint16(offset, BITS_PER_SAMPLE, true); offset += 2;
  writeStr("data");
  view.setUint32(offset, dataSize, true); offset += 4;
}

export interface DecodedWavPcm16Mono {
  samples: Float32Array;
  sampleRate: number;
}

/**
 * The encoder's sibling: parses a mono PCM16 RIFF/WAVE buffer (the shape encodeWavPcm16Mono
 * produces) back into Float32 samples. Walks chunks after the 12-byte RIFF header rather than
 * assuming the fixed 44-byte layout, so it tolerates any spec-conformant chunk ordering.
 */
export function decodeWavPcm16Mono(bytes: Uint8Array): DecodedWavPcm16Mono {
  if (bytes.length < 12) throw new Error("decodeWavPcm16Mono: buffer too short for a RIFF header");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const readStr = (offset: number, len: number): string => {
    let s = "";
    for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(offset + i));
    return s;
  };
  if (readStr(0, 4) !== "RIFF" || readStr(8, 4) !== "WAVE") {
    throw new Error("decodeWavPcm16Mono: not a RIFF/WAVE buffer");
  }

  let offset = 12;
  let sampleRate: number | undefined;
  let channels: number | undefined;
  let bitsPerSample: number | undefined;
  let dataOffset: number | undefined;
  let dataSize: number | undefined;
  while (offset + 8 <= bytes.length) {
    const id = readStr(offset, 4);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      bitsPerSample = view.getUint16(body + 14, true);
    } else if (id === "data") {
      dataOffset = body;
      dataSize = size;
    }
    offset = body + size + (size % 2); // chunks are word-aligned (a trailing pad byte on odd sizes)
  }

  if (sampleRate === undefined || channels === undefined || bitsPerSample === undefined || dataOffset === undefined || dataSize === undefined) {
    throw new Error("decodeWavPcm16Mono: missing fmt or data chunk");
  }
  if (channels !== 1) throw new Error(`decodeWavPcm16Mono: expected mono, got ${channels} channels`);
  if (bitsPerSample !== 16) throw new Error(`decodeWavPcm16Mono: expected 16-bit PCM, got ${bitsPerSample}-bit`);

  const frameCount = Math.floor(dataSize / 2);
  const samples = new Float32Array(frameCount);
  for (let i = 0; i < frameCount; i++) {
    const int16 = view.getInt16(dataOffset + i * 2, true);
    // Inverse of the encoder's asymmetric scale, so -32768 round-trips back to exactly -1.
    samples[i] = int16 < 0 ? int16 / 32768 : int16 / 32767;
  }
  return { samples, sampleRate };
}

export function encodeWavPcm16Mono(samples: Float32Array, inputSampleRate: number, targetRate = 16000): Uint8Array {
  const outFrames = Math.ceil((samples.length * targetRate) / inputSampleRate);
  const dataSize = outFrames * 2;
  const buffer = new ArrayBuffer(HEADER_BYTES + dataSize);
  const view = new DataView(buffer);
  writeHeader(view, targetRate, dataSize);

  const ratio = inputSampleRate / targetRate; // input samples per output sample
  let offset = HEADER_BYTES;
  for (let i = 0; i < outFrames; i++) {
    const srcPos = i * ratio;
    const idx0 = Math.floor(srcPos);
    const frac = srcPos - idx0;
    const s0 = samples[idx0] ?? 0;
    const s1 = samples[idx0 + 1] ?? s0;
    const interpolated = s0 + (s1 - s0) * frac;
    const clamped = Math.max(-1, Math.min(1, interpolated));
    // Asymmetric scale (int16 range is -32768..32767) so -1 round-trips to the true floor.
    const scaled = clamped < 0 ? clamped * 32768 : clamped * 32767;
    const int16 = Math.max(-32768, Math.min(32767, Math.round(scaled)));
    view.setInt16(offset, int16, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}
