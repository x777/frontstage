import { describe, expect, test } from "vitest";
import type { Clip } from "../src/clip.js";
import { defaultCrop, defaultTransform } from "../src/transform.js";
import { defaultTimeline } from "../src/timeline.js";
import type { Track } from "../src/timeline.js";
import { EditorStore, removeClipCommand, setClipPropertyCommand } from "../src/index.js";

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
});
