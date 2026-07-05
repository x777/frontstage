import { describe, expect, test } from "vitest";
import { EditorStore, defaultTimeline, defaultTransform, defaultCrop, type Timeline, type Track, type Clip } from "@frontstage/core";
import { selectClipAtPreviewPoint } from "../src/preview/preview-hit-test.js";

function clip(id: string, over: Partial<Clip> = {}): Clip {
  return {
    id, mediaRef: id, mediaType: "video", sourceClipType: "video",
    startFrame: 0, durationFrames: 100, trimStartFrame: 0, trimEndFrame: 0,
    speed: 1, volume: 1, fadeInFrames: 0, fadeOutFrames: 0,
    fadeInInterpolation: "linear", fadeOutInterpolation: "linear",
    opacity: 1, transform: defaultTransform(), crop: defaultCrop(), ...over,
  };
}
function track(clips: Clip[], over: Partial<Track> = {}): Track {
  return { id: "t", type: "video", muted: false, hidden: false, syncLocked: false, clips, ...over };
}
function timeline(tracks: Track[]): Timeline {
  return { ...defaultTimeline(), width: 1920, height: 1080, tracks };
}

// A displayed rect at half-scale, offset — mimics a letterboxed <canvas> via getBoundingClientRect().
const halfScaleRect = { left: 100, top: 50, width: 960, height: 540 };
const centerClientPoint = { x: 100 + 480, y: 50 + 270 }; // maps to composition (960, 540) — canvas center
const cornerClientPoint = { x: 100 + 5, y: 50 + 5 }; // maps to composition (10, 10) — near top-left corner

describe("selectClipAtPreviewPoint", () => {
  test("selects the clip whose full-canvas footprint contains the mapped composition point", () => {
    const store = new EditorStore(timeline([track([clip("a")])]));
    selectClipAtPreviewPoint(store, new Map(), centerClientPoint, halfScaleRect);
    expect([...store.getSnapshot().selection]).toEqual(["a"]);
  });

  test("a miss (no clip under the point) leaves the selection unchanged", () => {
    const store = new EditorStore(timeline([track([clip("a", { transform: { ...defaultTransform(), width: 0.1, height: 0.1 } })])]));
    store.select(["preexisting"]);
    selectClipAtPreviewPoint(store, new Map(), cornerClientPoint, halfScaleRect); // small centered clip, corner misses
    expect([...store.getSnapshot().selection]).toEqual(["preexisting"]);
  });

  test("z-order: picks the topmost (track 0) of two overlapping full-canvas clips", () => {
    const store = new EditorStore(timeline([
      track([clip("front")], { id: "front-track" }),
      track([clip("back")], { id: "back-track" }),
    ]));
    selectClipAtPreviewPoint(store, new Map(), centerClientPoint, halfScaleRect);
    expect([...store.getSnapshot().selection]).toEqual(["front"]);
  });

  test("expands the selection to the hit clip's link group", () => {
    const a = clip("a", { linkGroupId: "g" });
    const b = clip("b", { mediaType: "audio", sourceClipType: "video", linkGroupId: "g" });
    const store = new EditorStore(timeline([
      track([a]),
      track([b], { id: "audio", type: "audio" }),
    ]));
    selectClipAtPreviewPoint(store, new Map(), centerClientPoint, halfScaleRect);
    expect([...store.getSnapshot().selection].sort()).toEqual(["a", "b"]);
  });

  test("uses the current playhead frame, not frame 0", () => {
    const store = new EditorStore(timeline([track([
      clip("early", { startFrame: 0, durationFrames: 10 }),
      clip("late", { startFrame: 50, durationFrames: 10 }),
    ])]));
    store.setPlayhead(55);
    selectClipAtPreviewPoint(store, new Map(), centerClientPoint, halfScaleRect);
    expect([...store.getSnapshot().selection]).toEqual(["late"]);
  });

  test("a zero-size displayed rect (not yet laid out) is a no-op", () => {
    const store = new EditorStore(timeline([track([clip("a")])]));
    selectClipAtPreviewPoint(store, new Map(), centerClientPoint, { left: 0, top: 0, width: 0, height: 0 });
    expect([...store.getSnapshot().selection]).toEqual([]);
  });
});
