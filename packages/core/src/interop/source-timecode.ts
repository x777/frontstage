/** A source file's embedded start timecode: frame number in the timecode track's own `quanta` rate. */
export interface SourceTimecode {
  frame: number;
  quanta: number;
  dropFrame: boolean;
}

/** Port of Swift's `SourceTimecode.frames(atFPS:)` — converts the tc's own rate to `fps`-frame units. */
export function timecodeFrames(tc: SourceTimecode, fps: number): number {
  if (tc.quanta <= 0) return 0;
  return roundHalfAwayFromZero((tc.frame / tc.quanta) * fps);
}

/** Swift's `Double.rounded()` default (`.toNearestOrAwayFromZero`); `Math.round` differs on negative halves. */
export function roundHalfAwayFromZero(x: number): number {
  return x >= 0 ? Math.floor(x + 0.5) : Math.ceil(x - 0.5);
}
