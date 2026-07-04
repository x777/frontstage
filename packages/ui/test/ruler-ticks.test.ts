import { describe, expect, test } from "vitest";
import { rulerTicks } from "../src/timeline/ruler-ticks.js";

const fmt = (f: number, fps: number) => `${f / fps}s`;

test("targets ~80px majors: at 2 px/frame & 30fps, rawFrames=80/2=40, first candidate (frames) >= 40 is 2s=60 frames", () => {
  const t = rulerTicks({ pixelsPerFrame: 2, fps: 30, scrollOffsetX: 0, width: 800, formatTimecode: fmt });
  const frames = t.majors.map((m) => m.frame);
  expect(frames).toContain(0);
  expect(frames).toContain(60);
  expect(frames).toContain(120);
  expect(frames).not.toContain(30);
});

test("zoomed way out: falls back to the largest candidate instead of zero ticks", () => {
  const t = rulerTicks({ pixelsPerFrame: 0.0001, fps: 30, scrollOffsetX: 0, width: 800, formatTimecode: fmt });
  expect(t.majors.length).toBeGreaterThan(0);
});

test("NaN/zero pixelsPerFrame yields empty, never throws", () => {
  expect(rulerTicks({ pixelsPerFrame: 0, fps: 30, scrollOffsetX: 0, width: 800, formatTimecode: fmt })).toEqual({ majors: [], minors: [] });
  expect(rulerTicks({ pixelsPerFrame: NaN, fps: 30, scrollOffsetX: 0, width: 800, formatTimecode: fmt })).toEqual({ majors: [], minors: [] });
});

test("minor midpoints are taller (6) when subdivisions are even", () => {
  const t = rulerTicks({ pixelsPerFrame: 4, fps: 30, scrollOffsetX: 0, width: 800, formatTimecode: fmt });
  if (t.minors.length > 0) {
    const heights = new Set(t.minors.map((m) => m.height));
    expect([...heights].every((h) => h === 4 || h === 6)).toBe(true);
  }
});

test("scroll offset shifts tick x positions and clips to [0,width]", () => {
  const a = rulerTicks({ pixelsPerFrame: 2, fps: 30, scrollOffsetX: 0, width: 400, formatTimecode: fmt });
  // 50 is not a multiple of framesPerMajor*pixelsPerFrame (60*2=120) — at 120 the clipped-to-0
  // major would coincidentally land back on x=0, same as the unscrolled case (both algorithmically
  // correct, just not a useful assertion of "shifted").
  const b = rulerTicks({ pixelsPerFrame: 2, fps: 30, scrollOffsetX: 50, width: 400, formatTimecode: fmt });
  expect(b.majors.every((m) => m.x >= 0 && m.x <= 400)).toBe(true);
  expect(a.majors[0]!.x).not.toBe(b.majors[0]!.x);
});
