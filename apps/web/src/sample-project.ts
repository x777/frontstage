import type { Timeline } from "@palmier/core";
import { MediaLibrary } from "@palmier/ui";

export function sampleTimeline(): Timeline {
  const fps = 30;
  const width = 320;
  const height = 240;
  // clip.mp4 is a short fixture; use 3 seconds (90 frames)
  const durationFrames = 90;

  return {
    fps,
    width,
    height,
    settingsConfigured: true,
    tracks: [
      {
        id: "track-video-1",
        type: "video",
        muted: false,
        hidden: false,
        syncLocked: false,
        clips: [
          {
            id: "clip-1",
            mediaRef: "clip.mp4",
            mediaType: "video",
            sourceClipType: "video",
            startFrame: 0,
            durationFrames,
            trimStartFrame: 0,
            trimEndFrame: 0,
            speed: 1,
            volume: 1,
            fadeInFrames: 0,
            fadeOutFrames: 0,
            fadeInInterpolation: "linear",
            fadeOutInterpolation: "linear",
            opacity: 1,
            transform: {
              centerX: 0.5,
              centerY: 0.5,
              width: 1,
              height: 1,
              rotation: 0,
              flipHorizontal: false,
              flipVertical: false,
            },
            crop: { top: 0, bottom: 0, left: 0, right: 0 },
          },
        ],
      },
    ],
  };
}

export async function buildSampleLibrary(): Promise<MediaLibrary> {
  const lib = new MediaLibrary();
  await lib.seed("clip.mp4", "/clip.mp4", {
    id: "clip.mp4",
    name: "clip.mp4",
    type: "video",
    source: { kind: "project", relativePath: "media/clip.mp4" },
    duration: 3,
  });
  return lib;
}
