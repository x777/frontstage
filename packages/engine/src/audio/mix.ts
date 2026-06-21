export interface MixSource {
  pcm: Float32Array;
  channels: number;
  sampleRate: number;
  startFrame: number;
  endFrame: number;
  trimStartFrame: number;
  speed: number;
}

export function mixWindow(
  sources: MixSource[],
  startSample: number,
  frameCount: number,
  outSampleRate: number,
  fps: number,
  gainFor: (i: number, timelineFrame: number) => number,
): Float32Array {
  const outChannels = sources.length > 0 ? sources[0]!.channels : 1;
  const out = new Float32Array(frameCount * outChannels);

  for (let s = 0; s < frameCount; s++) {
    const timelineSample = startSample + s;
    const timelineFrame = Math.floor((timelineSample / outSampleRate) * fps);

    for (let i = 0; i < sources.length; i++) {
      const src = sources[i]!;
      if (timelineFrame < src.startFrame || timelineFrame >= src.endFrame) continue;

      const srcSec =
        ((timelineSample / outSampleRate) - src.startFrame / fps) * src.speed +
        src.trimStartFrame / fps;
      const srcIdx = Math.round(srcSec * src.sampleRate);
      const maxSrcIdx = src.pcm.length / src.channels;
      if (srcIdx < 0 || srcIdx >= maxSrcIdx) continue;

      const gain = gainFor(i, timelineFrame);
      for (let ch = 0; ch < outChannels; ch++) {
        const outIdx = s * outChannels + ch;
        out[outIdx] = (out[outIdx] ?? 0) + (src.pcm[srcIdx * src.channels + ch] ?? 0) * gain;
      }
    }

    for (let ch = 0; ch < outChannels; ch++) {
      const idx = s * outChannels + ch;
      out[idx] = Math.max(-1, Math.min(1, out[idx]!));
    }
  }

  return out;
}
