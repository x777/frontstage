import { demuxMp4, buildVideoChunks, VideoDecodeManager } from "@palmier/engine";

interface PumpStepResult {
  ts: number;
  buffered: number;
  open: number;
}

declare global {
  interface Window {
    __pumpStep: (targetUs: number) => PumpStepResult | undefined;
    __bufferedCount: () => number;
    __openFrames: () => number;
    __pumpReady: boolean;
  }
}

async function main(): Promise<void> {
  const status = document.getElementById("status")!;
  try {
    const resp = await fetch("/test/fixtures/clip.mp4");
    const fileBytes = await resp.arrayBuffer();
    const blob = new Blob([fileBytes], { type: "video/mp4" });
    const result = await demuxMp4(blob);
    if (!result.video) throw new Error("no video track");

    const chunks = buildVideoChunks(result.video, fileBytes);
    const mgr = await VideoDecodeManager.create(result.video, chunks);

    mgr.seekTo(0);

    window.__bufferedCount = () => mgr.bufferedCount();
    window.__openFrames = () => mgr.openFrameCount();

    window.__pumpStep = (targetUs: number): PumpStepResult | undefined => {
      mgr.pump();
      const frame = mgr.frameForMicros(targetUs);
      if (!frame) return undefined;
      return { ts: frame.timestamp, buffered: mgr.bufferedCount(), open: mgr.openFrameCount() };
    };

    status.textContent = "ok";
    window.__pumpReady = true;
  } catch (e) {
    const msg = "error: " + (e as Error).message;
    status.textContent = msg;
    console.error(e);
  }
}

void main();
