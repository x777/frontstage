import { describe, expect, test } from "vitest";
import type { Clip } from "../src/clip.js";
import { defaultCrop, defaultTransform } from "../src/transform.js";
import { defaultTimeline } from "../src/timeline.js";
import type { Track } from "../src/timeline.js";
import { EditorStore, removeClipCommand, setClipPropertyCommand, ZOOM_MIN, ZOOM_MAX, ZOOM_TOOLBAR_STEP } from "../src/index.js";

function makeClip(id: string): Clip {
  return {
    id,
    mediaRef: "m",
    mediaType: "video",
    sourceClipType: "video",
    startFrame: 0,
    durationFrames: 30,
    trimStartFrame: 0,
    trimEndFrame: 0,
    speed: 1,
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    fadeInInterpolation: "linear",
    fadeOutInterpolation: "linear",
    opacity: 1,
    transform: defaultTransform(),
    crop: defaultCrop(),
  };
}

function makeTrack(clips: Clip[]): Track {
  return { id: "t1", type: "video", muted: false, hidden: false, syncLocked: false, clips };
}

describe("editor-store", () => {
  test("transient setters notify subscribers and change snapshot identity, but are not undoable", () => {
    const store = new EditorStore(defaultTimeline());
    let n = 0;
    const unsub = store.subscribe(() => { n++; });
    const before = store.getSnapshot();
    store.setPlayhead(10);
    expect(store.getSnapshot()).not.toBe(before);
    expect(store.getSnapshot().playhead).toBe(10);
    expect(n).toBe(1);
    expect(store.canUndo()).toBe(false);
    unsub();
    store.setPlayhead(20);
    expect(n).toBe(1); // unsubscribed, no additional notification
  });

  test("selection setter stores ids", () => {
    const store = new EditorStore(defaultTimeline());
    store.select(["c1", "c2"]);
    const snap = store.getSnapshot();
    expect(snap.selection.has("c1")).toBe(true);
    expect(snap.selection.has("c2")).toBe(true);
    expect(snap.selection.size).toBe(2);
  });

  test("getSnapshot returns same object until state changes", () => {
    const store = new EditorStore(defaultTimeline());
    const s1 = store.getSnapshot();
    const s2 = store.getSnapshot();
    expect(s1).toBe(s2);
    store.setPlayhead(5);
    const s3 = store.getSnapshot();
    expect(s3).not.toBe(s1);
  });

  test("dispatch creates new snapshot identity", () => {
    const timeline = { ...defaultTimeline(), tracks: [makeTrack([makeClip("c1")])] };
    const store = new EditorStore(timeline);
    const before = store.getSnapshot();
    store.dispatch(removeClipCommand("c1"));
    expect(store.getSnapshot()).not.toBe(before);
  });

  test("subscribe returns unsubscribe function", () => {
    const store = new EditorStore(defaultTimeline());
    let count = 0;
    const unsub = store.subscribe(() => count++);
    store.setPlayhead(1);
    expect(count).toBe(1);
    unsub();
    store.setPlayhead(2);
    expect(count).toBe(1);
  });

  test("setZoom updates view.zoom", () => {
    const store = new EditorStore(defaultTimeline());
    store.setZoom(2.5);
    expect(store.getSnapshot().view.zoom).toBe(2.5);
  });

  test("setScroll updates view.scrollX", () => {
    const store = new EditorStore(defaultTimeline());
    store.setScroll(100);
    expect(store.getSnapshot().view.scrollX).toBe(100);
  });

  test("setFocusedPanel updates layout.focused", () => {
    const store = new EditorStore(defaultTimeline());
    store.setFocusedPanel("media");
    expect(store.getSnapshot().layout.focused).toBe("media");
  });

  test("setMaximized updates layout.maximized", () => {
    const store = new EditorStore(defaultTimeline());
    store.setMaximized("preview");
    expect(store.getSnapshot().layout.maximized).toBe("preview");
    store.setMaximized(null);
    expect(store.getSnapshot().layout.maximized).toBe(null);
  });

  test("togglePanelHidden adds and removes a panel", () => {
    const store = new EditorStore(defaultTimeline());
    store.togglePanelHidden("inspector");
    expect(store.getSnapshot().layout.hidden).toContain("inspector");
    store.togglePanelHidden("inspector");
    expect(store.getSnapshot().layout.hidden).not.toContain("inspector");
  });

  test("transient setter breaks coalesce run", () => {
    const timeline = { ...defaultTimeline(), tracks: [makeTrack([makeClip("c1")])] };
    const store = new EditorStore(timeline);
    store.dispatch(setClipPropertyCommand("c1", "volume", 0.5, "vol-c1"));
    store.setPlayhead(5); // transient — breaks coalesce
    store.dispatch(setClipPropertyCommand("c1", "volume", 0.2, "vol-c1"));
    // now there should be 2 undo entries
    store.undo();
    expect(store.getSnapshot().timeline.tracks[0]!.clips[0]!.volume).toBe(0.5);
    store.undo();
    expect(store.getSnapshot().timeline.tracks[0]!.clips[0]!.volume).toBe(1);
  });

  test("dispatch coalesces consecutive same-key commands into one undo entry (single continuous drag)", () => {
    const timeline = { ...defaultTimeline(), tracks: [makeTrack([makeClip("c1")])] };
    const store = new EditorStore(timeline);
    store.dispatch(setClipPropertyCommand("c1", "volume", 0.5, "trim-c1"));
    store.dispatch(setClipPropertyCommand("c1", "volume", 0.3, "trim-c1"));
    store.dispatch(setClipPropertyCommand("c1", "volume", 0.2, "trim-c1"));
    expect(store.getSnapshot().timeline.tracks[0]!.clips[0]!.volume).toBe(0.2);
    store.undo();
    expect(store.getSnapshot().timeline.tracks[0]!.clips[0]!.volume).toBe(1); // pre-gesture value
    expect(store.canUndo()).toBe(false);
  });

  test("breakCoalescing() ends the run — two gestures reusing the same coalesce key produce two undo entries", () => {
    // Models two consecutive trim gestures on the SAME already-selected clip edge: the coalesce
    // key ("trim-"+clipId) is identical across gestures because it's a per-clip constant, so
    // without an explicit break at gesture end the second gesture would merge into the first's
    // undo entry (the M14C bug: select() on an already-selected clip is a no-op and never resets
    // lastCoalesceKey). TimelinePanel now calls store.breakCoalescing() on pointerup for this.
    const timeline = { ...defaultTimeline(), tracks: [makeTrack([makeClip("c1")])] };
    const store = new EditorStore(timeline);

    // Gesture 1 — a couple of drag ticks
    store.dispatch(setClipPropertyCommand("c1", "volume", 0.5, "trim-c1"));
    store.dispatch(setClipPropertyCommand("c1", "volume", 0.4, "trim-c1"));
    store.breakCoalescing(); // gesture 1 end (pointerup)

    // Gesture 2 — same clip, same coalesce key
    store.dispatch(setClipPropertyCommand("c1", "volume", 0.3, "trim-c1"));
    store.dispatch(setClipPropertyCommand("c1", "volume", 0.2, "trim-c1"));
    store.breakCoalescing(); // gesture 2 end (pointerup)

    expect(store.getSnapshot().timeline.tracks[0]!.clips[0]!.volume).toBe(0.2);
    store.undo();
    expect(store.getSnapshot().timeline.tracks[0]!.clips[0]!.volume).toBe(0.4); // undoes gesture 2 only
    expect(store.canUndo()).toBe(true);
    store.undo();
    expect(store.getSnapshot().timeline.tracks[0]!.clips[0]!.volume).toBe(1); // undoes gesture 1
    expect(store.canUndo()).toBe(false);
  });

  test("undo when stack empty is a no-op", () => {
    const store = new EditorStore(defaultTimeline());
    const before = store.getSnapshot();
    store.undo();
    expect(store.getSnapshot()).toBe(before);
  });

  test("redo when stack empty is a no-op", () => {
    const store = new EditorStore(defaultTimeline());
    const before = store.getSnapshot();
    store.redo();
    expect(store.getSnapshot()).toBe(before);
  });

  test("no-op transient setters do not notify subscribers", () => {
    const store = new EditorStore(defaultTimeline());
    let n = 0;
    store.subscribe(() => { n++; });

    store.setPlayhead(0); // same as initial
    expect(n).toBe(0);

    store.setPlayhead(5);
    expect(n).toBe(1);
    store.setPlayhead(5); // same value
    expect(n).toBe(1);

    store.setZoom(1); // initial value
    expect(n).toBe(1);
    store.setZoom(2);
    expect(n).toBe(2);
    store.setZoom(2); // same
    expect(n).toBe(2);

    store.setScroll(0); // initial
    expect(n).toBe(2);
    store.setScroll(50);
    expect(n).toBe(3);
    store.setScroll(50); // same
    expect(n).toBe(3);

    store.setFocusedPanel("timeline"); // initial focused
    expect(n).toBe(3);
    store.setFocusedPanel("media");
    expect(n).toBe(4);
    store.setFocusedPanel("media"); // same
    expect(n).toBe(4);

    store.setMaximized(null); // initial
    expect(n).toBe(4);
    store.setMaximized("preview");
    expect(n).toBe(5);
    store.setMaximized("preview"); // same
    expect(n).toBe(5);

    store.select([]); // initial selection is empty
    expect(n).toBe(5);
    store.select(["c1"]);
    expect(n).toBe(6);
    store.select(["c1"]); // same set
    expect(n).toBe(6);

    // togglePanelHidden: toggling twice back to original is a no-op on second toggle
    store.togglePanelHidden("inspector");
    expect(n).toBe(7);
    store.togglePanelHidden("inspector"); // removes it — back to []
    expect(n).toBe(8);
    // Now toggle again, then try to toggle a panel that is not hidden — no-op not possible
    // but re-adding same panel after it's already removed returns to previous state
  });

  test("load() replaces the timeline, clears undo/redo, resets transient, keeps layout", () => {
    const s = new EditorStore(defaultTimeline());
    s.dispatch({ label: "x", apply: (t) => ({ ...t, fps: 60 }) });
    expect(s.canUndo()).toBe(true);
    s.select(["a"]); s.setPlayhead(10); s.setMaximized("timeline");
    const next = { ...defaultTimeline(), width: 111 };
    s.load(next);
    const snap = s.getSnapshot();
    expect(snap.timeline.width).toBe(111);
    expect(s.canUndo()).toBe(false);   // undo cleared — can't cross into the previous project
    expect(s.canRedo()).toBe(false);
    expect(snap.selection.size).toBe(0);
    expect(snap.playhead).toBe(0);
    expect(snap.view).toEqual({ zoom: 1, scrollX: 0 });
    expect(snap.layout.maximized).toBe("timeline"); // layout preserved
  });

  test("toolMode defaults to pointer and setToolMode switches + emits", () => {
    const store = new EditorStore(defaultTimeline());
    expect(store.getSnapshot().toolMode).toBe("pointer");
    let emits = 0;
    store.subscribe(() => emits++);
    store.setToolMode("razor");
    expect(store.getSnapshot().toolMode).toBe("razor");
    expect(emits).toBe(1);
    store.setToolMode("razor"); // same value → no emit
    expect(emits).toBe(1);
  });

  test("setToolMode does not touch the undo stack", () => {
    const store = new EditorStore(defaultTimeline());
    store.setToolMode("razor");
    expect(store.canUndo()).toBe(false);
  });

  test("zoom constants match Swift", () => {
    expect(ZOOM_MIN).toBe(0.05);
    expect(ZOOM_MAX).toBe(40);
    expect(ZOOM_TOOLBAR_STEP).toBe(1.25);
  });
});
