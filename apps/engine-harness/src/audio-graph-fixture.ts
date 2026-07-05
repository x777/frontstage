import { demuxMp4, buildAudioChunks, AudioDecodeManager, AudioGraph } from "@frontstage/engine";

interface AudioGraphRunResult {
  isolated: boolean;
  t0: number;
  t1: number;
  ringDrained: boolean;
  initialAvail: number;
}

declare global {
  interface Window {
    __audioGraphReady: boolean;
    __audioGraphRun: () => Promise<AudioGraphRunResult>;
    __ringDrained: boolean;
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

    const graph = await AudioGraph.create(result.audio.channels, result.audio.sampleRate);

    // Push ~0.5s of PCM into the ring before starting
    const halfSecFrames = Math.ceil(result.audio.sampleRate * 0.5);
    let framesBuffered = 0;
    await mgr.decodeAll((pcm) => {
      if (framesBuffered < halfSecFrames) {
        graph.pushPcm(pcm);
        framesBuffered += pcm.data.length / pcm.channels;
      }
    });

    const initialAvail = graph.availableRead;
    await graph.start();

    window.__audioGraphRun = async (): Promise<AudioGraphRunResult> => {
      const isolated = self.crossOriginIsolated;
      const t0 = graph.currentTime;
      await new Promise<void>((resolve) => setTimeout(resolve, 350));
      const t1 = graph.currentTime;
      const ringDrained = graph.availableRead < initialAvail;
      window.__ringDrained = ringDrained;
      return { isolated, t0, t1, ringDrained, initialAvail };
    };

    status.textContent = "ok";
    window.__audioGraphReady = true;
  } catch (e) {
    const msg = "error: " + (e as Error).message;
    status.textContent = msg;
    console.error(e);
  }
}

void main();
