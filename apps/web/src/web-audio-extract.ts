import { demuxMp4, buildAudioChunks, AudioDecodeManager, encodeWavPcm16Mono } from "@palmier/engine";

export interface WebAudioExtractDeps {
  openBlob(mediaRef: string): Promise<Blob>;
}

// Downmix an interleaved multi-channel PCM buffer to mono by averaging channels.
// Pure + cheap: extracted so it carries a unit test outside the WebCodecs pipeline.
export function downmixToMono(interleaved: Float32Array, channels: number): Float32Array {
  if (channels <= 1) return interleaved;
  const frames = Math.floor(interleaved.length / channels);
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let ch = 0; ch < channels; ch++) sum += interleaved[i * channels + ch]!;
    mono[i] = sum / channels;
  }
  return mono;
}

export function makeWebAudioExtractor(
  deps: WebAudioExtractDeps,
): (mediaRef: string) => Promise<{ wav: Uint8Array; durationSeconds: number }> {
  return async (mediaRef: string) => {
    const blob = await deps.openBlob(mediaRef);
    const fileBytes = await blob.arrayBuffer();

    // v1 limit: demuxMp4 (mp4box.js) only parses ISOBMFF containers — mp4/mov/m4a all
    // work generically (any ISOBMFF brand with audio/video tracks), but a plain mp3/wav
    // file has no ftyp/moov box and demuxMp4 rejects it. Surface a clear error for those.
    const demux = await demuxMp4(new Blob([fileBytes])).catch(() => {
      throw new Error("unsupported audio container for transcription");
    });
    if (!demux.audio) throw new Error("no audio track");

    const chunks = buildAudioChunks(demux.audio, fileBytes);
    const mgr = await AudioDecodeManager.create(demux.audio, chunks);

    const monoChunks: Float32Array[] = [];
    let sampleRate = demux.audio.sampleRate;
    let totalFrames = 0;
    await mgr.decodeAll((pcm) => {
      sampleRate = pcm.sampleRate;
      const mono = downmixToMono(pcm.data, pcm.channels);
      monoChunks.push(mono);
      totalFrames += mono.length;
    });

    const combined = new Float32Array(totalFrames);
    let offset = 0;
    for (const c of monoChunks) {
      combined.set(c, offset);
      offset += c.length;
    }

    const wav = encodeWavPcm16Mono(combined, sampleRate, 16000);
    const durationSeconds = totalFrames / sampleRate;
    return { wav, durationSeconds };
  };
}
