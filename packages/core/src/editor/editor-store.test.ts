import { describe, it, expect } from "vitest";
import { EditorStore } from "./editor-store.js";
import type { Timeline } from "../timeline.js";

function tl(): Timeline {
  return { fps: 30, width: 1920, height: 1080, settingsConfigured: true, tracks: [] };
}

describe("EditorStore selection extras (M8.6)", () => {
  it("starts with null gap and range", () => {
    const s = new EditorStore(tl());
    expect(s.getSnapshot().selectedGap).toBeNull();
    expect(s.getSnapshot().selectedTimelineRange).toBeNull();
  });

  it("setSelectedGap clears the clip selection", () => {
    const s = new EditorStore(tl());
    s.select(["a", "b"]);
    s.setSelectedGap({ trackIndex: 0, range: { start: 10, end: 20 } });
    expect(s.getSnapshot().selectedGap).toEqual({ trackIndex: 0, range: { start: 10, end: 20 } });
    expect([...s.getSnapshot().selection]).toEqual([]);
  });

  it("select clears a selected gap", () => {
    const s = new EditorStore(tl());
    s.setSelectedGap({ trackIndex: 0, range: { start: 10, end: 20 } });
    s.select(["a"]);
    expect(s.getSnapshot().selectedGap).toBeNull();
    expect([...s.getSnapshot().selection]).toEqual(["a"]);
  });

  it("setSelectedTimelineRange clamps edges to >= 0", () => {
    const s = new EditorStore(tl());
    s.setSelectedTimelineRange({ startFrame: -5, endFrame: 40 });
    expect(s.getSnapshot().selectedTimelineRange).toEqual({ startFrame: 0, endFrame: 40 });
  });

  it("keepValidTimelineRangeOrClear normalizes a valid range and clears an invalid one", () => {
    const s = new EditorStore(tl());
    s.setSelectedTimelineRange({ startFrame: 40, endFrame: 10 }); // inverted
    s.keepValidTimelineRangeOrClear();
    expect(s.getSnapshot().selectedTimelineRange).toEqual({ startFrame: 10, endFrame: 40 }); // normalized
    s.setSelectedTimelineRange({ startFrame: 10, endFrame: 10 }); // zero-length
    s.keepValidTimelineRangeOrClear();
    expect(s.getSnapshot().selectedTimelineRange).toBeNull();
  });

  it("load resets gap and range", () => {
    const s = new EditorStore(tl());
    s.setSelectedGap({ trackIndex: 0, range: { start: 0, end: 5 } });
    s.load(tl());
    expect(s.getSnapshot().selectedGap).toBeNull();
    expect(s.getSnapshot().selectedTimelineRange).toBeNull();
  });
});
