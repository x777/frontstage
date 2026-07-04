import { describe, it, expect } from "vitest";
import type { Clip } from "../clip.js";
import type { Timeline, Track } from "../timeline.js";
import { EditorStore } from "./editor-store.js";
import { selectForwardAction, selectForwardFromClip, dispatchRippleDeleteSelection, dispatchRippleDeleteGap, dispatchLinkSelection, dispatchUnlinkSelection } from "./store-actions.js";

function clip(id: string, startFrame: number, durationFrames: number, over: Partial<Clip> = {}): Clip {
  return {
    id, mediaRef: "m", mediaType: "video", sourceClipType: "video",
    startFrame, durationFrames, trimStartFrame: 0, trimEndFrame: 0,
    speed: 1, volume: 1, fadeInFrames: 0, fadeOutFrames: 0,
    fadeInInterpolation: "linear", fadeOutInterpolation: "linear", opacity: 1,
    transform: { centerX: 0.5, centerY: 0.5, width: 1, height: 1, rotation: 0, flipHorizontal: false, flipVertical: false },
    crop: { top: 0, bottom: 0, left: 0, right: 0 }, ...over,
  };
}
function track(id: string, clips: Clip[], type: Track["type"] = "video"): Track {
  return { id, type, muted: false, hidden: false, syncLocked: false, clips };
}
function timeline(tracks: Track[]): Timeline {
  return { fps: 30, width: 1920, height: 1080, settingsConfigured: true, tracks };
}

describe("selectForwardAction", () => {
  it("selects forward from the leftmost selected clip and clears gap/range", () => {
    const s = new EditorStore(timeline([track("t", [clip("a", 0, 10), clip("b", 40, 10), clip("c", 80, 10)])]));
    s.select(["b"]);
    s.setSelectedTimelineRange({ startFrame: 5, endFrame: 9 });
    selectForwardAction(s, "track");
    expect([...s.getSnapshot().selection].sort()).toEqual(["b", "c"]);
    expect(s.getSnapshot().selectedTimelineRange).toBeNull();
  });
});

describe("selectForwardFromClip", () => {
  it("uses the given clip as anchor, ignoring the current selection", () => {
    const s = new EditorStore(timeline([track("t", [clip("a", 0, 10), clip("b", 40, 10), clip("c", 80, 10)])]));
    s.select(["a"]); // current selection's earliest is "a" — should be irrelevant here
    s.setSelectedTimelineRange({ startFrame: 5, endFrame: 9 });
    selectForwardFromClip(s, "b", "track");
    expect([...s.getSnapshot().selection].sort()).toEqual(["b", "c"]);
    expect(s.getSnapshot().selectedTimelineRange).toBeNull();
  });

  it("scope allTracks selects forward across every track from the given clip's frame", () => {
    const s = new EditorStore(timeline([
      track("t1", [clip("a", 0, 10), clip("b", 40, 10)]),
      track("t2", [clip("x", 20, 10), clip("y", 50, 10)], "audio"),
    ]));
    selectForwardFromClip(s, "b", "allTracks"); // anchor frame 40
    expect([...s.getSnapshot().selection].sort()).toEqual(["b", "y"]); // x (frame 20) excluded
  });
});

describe("dispatchRippleDeleteSelection", () => {
  it("ripple-deletes the selection as one undoable step and clears selection", () => {
    const s = new EditorStore(timeline([track("t", [clip("a", 0, 40), clip("b", 40, 10)])]));
    s.select(["a"]);
    const out = dispatchRippleDeleteSelection(s);
    expect("timeline" in out).toBe(true);
    expect(s.getSnapshot().timeline.tracks[0]!.clips.map((c) => c.id)).toEqual(["b"]);
    expect(s.getSnapshot().timeline.tracks[0]!.clips[0]!.startFrame).toBe(0); // rippled
    expect([...s.getSnapshot().selection]).toEqual([]);
    expect(s.canUndo()).toBe(true);
    s.undo();
    expect(s.getSnapshot().timeline.tracks[0]!.clips.map((c) => c.id).sort()).toEqual(["a", "b"]);
  });
});

describe("dispatchRippleDeleteGap", () => {
  it("closes the selected gap and clears it", () => {
    const s = new EditorStore(timeline([track("t", [clip("a", 0, 10), clip("b", 30, 10)])]));
    s.setSelectedGap({ trackIndex: 0, range: { start: 10, end: 30 } });
    const out = dispatchRippleDeleteGap(s);
    expect("timeline" in out).toBe(true);
    expect(s.getSnapshot().timeline.tracks[0]!.clips.find((c) => c.id === "b")!.startFrame).toBe(10);
    expect(s.getSnapshot().selectedGap).toBeNull();
  });
  it("clears a stale gap without dispatching", () => {
    const s = new EditorStore(timeline([track("t", [clip("a", 0, 40)])])); // a fills the gap
    s.setSelectedGap({ trackIndex: 0, range: { start: 10, end: 30 } });
    const out = dispatchRippleDeleteGap(s);
    expect(out).toEqual({ stale: true });
    expect(s.getSnapshot().selectedGap).toBeNull();
    expect(s.canUndo()).toBe(false);
  });
});

describe("link / unlink", () => {
  it("dispatchLinkSelection stamps a shared linkGroupId; unlink clears it and the selection", () => {
    const s = new EditorStore(timeline([track("v", [clip("x", 0, 10)]), track("a", [clip("y", 0, 10)], "audio")]));
    s.select(["x", "y"]);
    dispatchLinkSelection(s);
    const g1 = s.getSnapshot().timeline.tracks[0]!.clips[0]!.linkGroupId;
    expect(g1).toBeDefined();
    expect(s.getSnapshot().timeline.tracks[1]!.clips[0]!.linkGroupId).toBe(g1);
    s.select(["x"]);
    dispatchUnlinkSelection(s);
    expect(s.getSnapshot().timeline.tracks[0]!.clips[0]!.linkGroupId).toBeUndefined();
    expect(s.getSnapshot().timeline.tracks[1]!.clips[0]!.linkGroupId).toBeUndefined(); // expanded
    expect([...s.getSnapshot().selection]).toEqual([]);
  });
});
