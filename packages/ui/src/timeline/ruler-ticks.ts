/**
 * Pure port of TimelineRuler.swift's tick math (Sources/PalmierPro/Timeline/TimelineRuler.swift).
 * Produces tick geometry only — no canvas/DOM access — so draw-timeline.ts stays the single
 * place that touches the palette and CanvasRenderingContext2D.
 */
export interface RulerTicks {
  majors: { frame: number; x: number; label: string }[];
  minors: { x: number; height: 4 | 6 }[];
}

const TARGET_MAJOR_PX = 80;
const MAJOR_CANDIDATE_SECONDS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600];
const MINOR_DIVISION_CANDIDATES = [10, 5, 4, 2];
const MIN_MINOR_PX = 12;

/** Swift's `Int / Int` truncates toward zero; all inputs here are non-negative so this equals floor. */
function intDiv(a: number, b: number): number {
  return Math.trunc(a / b);
}

/** Choose a tick interval (in frames) that keeps major ticks ~80px apart. */
function tickInterval(pixelsPerFrame: number, fps: number): number {
  const rawFrames = TARGET_MAJOR_PX / pixelsPerFrame;
  const candidates = MAJOR_CANDIDATE_SECONDS.map((s) => s * fps);
  return candidates.find((c) => c >= rawFrames) ?? candidates[candidates.length - 1]!;
}

/** How many minor subdivisions fit between major ticks (each >= 12px apart), else 0. */
function minorSubdivisions(framesPerMajor: number, pixelsPerFrame: number): number {
  const majorPixels = framesPerMajor * pixelsPerFrame;
  for (const divisions of MINOR_DIVISION_CANDIDATES) {
    if (majorPixels / divisions >= MIN_MINOR_PX) return divisions;
  }
  return 0;
}

export function rulerTicks(args: {
  pixelsPerFrame: number;
  fps: number;
  scrollOffsetX: number;
  width: number;
  formatTimecode: (frame: number, fps: number) => string;
}): RulerTicks {
  const { pixelsPerFrame, fps, scrollOffsetX, width, formatTimecode } = args;
  const empty: RulerTicks = { majors: [], minors: [] };

  // Tick math divides by pixelsPerFrame — NaN/±Inf would trap.
  if (!(pixelsPerFrame > 0 && Number.isFinite(pixelsPerFrame))) return empty;

  const framesPerMajor = tickInterval(pixelsPerFrame, fps);
  if (framesPerMajor <= 0) return empty;

  const startFrame = Math.max(0, Math.trunc(scrollOffsetX / pixelsPerFrame) - framesPerMajor);
  const endFrame = Math.trunc((scrollOffsetX + width) / pixelsPerFrame) + framesPerMajor;

  const minorCount = minorSubdivisions(framesPerMajor, pixelsPerFrame);
  const framesPerMinor = minorCount > 0 ? intDiv(framesPerMajor, minorCount) : 0;

  const minors: { x: number; height: 4 | 6 }[] = [];
  if (framesPerMinor > 0) {
    const halfMajor = intDiv(framesPerMajor, 2);
    let minorFrame = intDiv(startFrame, framesPerMinor) * framesPerMinor;
    while (minorFrame <= endFrame) {
      if (minorFrame % framesPerMajor !== 0) {
        const x = minorFrame * pixelsPerFrame - scrollOffsetX;
        if (x >= 0 && x <= width) {
          const isMidpoint = minorCount % 2 === 0 && minorFrame % halfMajor === 0;
          minors.push({ x, height: isMidpoint ? 6 : 4 });
        }
      }
      minorFrame += framesPerMinor;
    }
  }

  const majors: { frame: number; x: number; label: string }[] = [];
  let frame = intDiv(startFrame, framesPerMajor) * framesPerMajor;
  while (frame <= endFrame) {
    const x = frame * pixelsPerFrame - scrollOffsetX;
    if (x >= 0 && x <= width) {
      majors.push({ frame, x, label: formatTimecode(frame, fps) });
    }
    frame += framesPerMajor;
  }

  return { majors, minors };
}
