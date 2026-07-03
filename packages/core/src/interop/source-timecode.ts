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

const TIMECODE_TAG_PATTERN = /^(\d{1,2}):(\d{1,2}):(\d{1,2})[:;](\d{1,2})$/;

/**
 * Parses an ffprobe `tags.timecode` string ("HH:MM:SS:FF" or drop-frame "HH:MM:SS;FF") into a
 * `SourceTimecode`. `quanta` is `fps` rounded to the nearest integer (ffprobe reports NTSC rates
 * like 23.976/29.97 as rationals; the nominal frame count uses the rounded integer, same as Swift's
 * tmcd `quanta`). `frame` is the linear frame count the tag addresses, using the standard SMPTE
 * drop-frame formula when `dropFrame` (frame numbers 0 and 1 are skipped at the start of every
 * minute except every 10th). Malformed input, an out-of-range field, or a non-positive fps → null.
 */
export function parseTimecodeTag(tag: string, fps: number): SourceTimecode | null {
  const quanta = Math.round(fps);
  if (quanta <= 0) return null;

  const m = TIMECODE_TAG_PATTERN.exec(tag.trim());
  if (!m) return null;
  const dropFrame = tag.includes(";");
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = Number(m[3]);
  const ff = Number(m[4]);
  if (mm > 59 || ss > 59 || ff >= quanta) return null;

  const frame = dropFrame ? dropFrameNumber(hh, mm, ss, ff, quanta) : hh * 3600 * quanta + mm * 60 * quanta + ss * quanta + ff;
  return { frame, quanta, dropFrame };
}

// Standard SMPTE drop-frame frame-number formula: drop `dropPerMinute` frame numbers (2 per 30-based
// rate, 4 per 60-based) at the start of every minute except every 10th.
function dropFrameNumber(hh: number, mm: number, ss: number, ff: number, quanta: number): number {
  const dropPerMinute = Math.round((quanta * 2) / 30);
  const totalMinutes = hh * 60 + mm;
  const framesPerMinute = quanta * 60;
  return framesPerMinute * totalMinutes + quanta * ss + ff - dropPerMinute * (totalMinutes - Math.trunc(totalMinutes / 10));
}
