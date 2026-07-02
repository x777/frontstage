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
