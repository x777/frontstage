import { demuxMp4, buildVideoChunks, VideoDecodeManager } from "@palmier/engine";

interface FrameResult {
  width: number;
  height: number;
  timestamp: number;
  openAfterClose: number;
}

declare global {
  interface Window {
    __decodeAt: (us: number) => Promise<FrameResult>;
    __openFrames: () => number;
    __decoderReady: boolean;
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

    window.__openFrames = () => mgr.openFrameCount();

    window.__decodeAt = async (us: number): Promise<FrameResult> => {
      const frame = await mgr.frameAtMicros(us);
      const width = frame.displayWidth;
      const height = frame.displayHeight;
      const timestamp = frame.timestamp;
      mgr.closeFrame(frame);
      return { width, height, timestamp, openAfterClose: mgr.openFrameCount() };
    };

    status.textContent = "ok";
    window.__decoderReady = true;
  } catch (e) {
    const msg = "error: " + (e as Error).message;
    status.textContent = msg;
    console.error(e);
  }
}

void main();
