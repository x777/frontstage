import { demuxMp4, buildAudioChunks, AudioDecodeManager } from "@palmier/engine";

interface AudioDecodeResult {
  totalFrames: number;
  sampleRate: number;
  channels: number;
}

declare global {
  interface Window {
    __audioDecode: () => AudioDecodeResult;
    __audioReady: boolean;
  }
}

async function main(): Promise<void> {
  const status = document.getElementById("status")!;
  try {
    const resp = await fetch("/test/fixtures/clip.mp4");
    const fileBytes = await resp.arrayBuffer();
    const blob = new Blob([fileBytes], { type: "video/mp4" });
    const result = await demuxMp4(blob);
    if (!result.audio) throw new Error("no audio track");

    const chunks = buildAudioChunks(result.audio, fileBytes);
    const mgr = await AudioDecodeManager.create(result.audio, chunks);

    let totalFrames = 0;
    let lastSampleRate = 0;
    let lastChannels = 0;

    await mgr.decodeAll((pcm) => {
      totalFrames += pcm.data.length / pcm.channels;
      lastSampleRate = pcm.sampleRate;
      lastChannels = pcm.channels;
    });

    window.__audioDecode = () => ({
      totalFrames,
      sampleRate: lastSampleRate,
      channels: lastChannels,
    });

    status.textContent = "ok";
    window.__audioReady = true;
  } catch (e) {
    const msg = "error: " + (e as Error).message;
    status.textContent = msg;
    console.error(e);
  }
}

void main();
