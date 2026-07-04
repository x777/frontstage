import { describe, expect, test } from "vitest";
import { EditorStore, defaultTimeline, defaultTransform, defaultCrop, type Timeline, type Track, type Clip } from "@palmier/core";
import { trimTickCommand, selectForwardScopeForKey } from "../src/timeline/pointer.js";

function clip(id: string, startFrame: number, durationFrames: number, over: Partial<Clip> = {}): Clip {
  return {
    id, mediaRef: "m", mediaType: "video", sourceClipType: "video",
    startFrame, durationFrames, trimStartFrame: 0, trimEndFrame: 30,
    speed: 1, volume: 1, fadeInFrames: 0, fadeOutFrames: 0,
    fadeInInterpolation: "linear", fadeOutInterpolation: "linear", opacity: 1,
    transform: defaultTransform(), crop: defaultCrop(), ...over,
  };
}
function track(id: string, clips: Clip[]): Track {
  return { id, type: "video", muted: false, hidden: false, syncLocked: false, clips };
}
function timeline(tracks: Track[]): Timeline {
  return { ...defaultTimeline(), tracks };
}

describe("trimTickCommand", () => {
  test("plain drag (isRipple=false): dispatches the absolute delta unchanged, downstream clip untouched", () => {
    const tl = timeline([track("t", [clip("a", 0, 30), clip("b", 30, 10)])]);
    const store = new EditorStore(tl);
    store.dispatch(trimTickCommand("a", "right", 20, false, 0, "trim-a"));
    expect(store.getSnapshot().timeline.tracks[0]!.clips.find((c) => c.id === "a")!.durationFrames).toBe(50);
    expect(store.getSnapshot().timeline.tracks[0]!.clips.find((c) => c.id === "b")!.startFrame).toBe(30); // unmoved
  });

  test("shift-drag ripple (isRipple=true): downstream clip rides forward by the same delta", () => {
    const tl = timeline([track("t", [clip("a", 0, 30), clip("b", 30, 10)])]);
    const store = new EditorStore(tl);
    store.dispatch(trimTickCommand("a", "right", 20, true, 0, "trim-a"));
    expect(store.getSnapshot().timeline.tracks[0]!.clips.find((c) => c.id === "a")!.durationFrames).toBe(50);
    expect(store.getSnapshot().timeline.tracks[0]!.clips.find((c) => c.id === "b")!.startFrame).toBe(50); // rippled
  });

  test("ripple: a full live-drag tick sequence re-derives the increment and coalesces to one undo", () => {
    const tl = timeline([track("t", [clip("a", 0, 30), clip("b", 30, 10)])]);
    const store = new EditorStore(tl);
    // Geometry helpers (trimRightDelta etc.) return the absolute offset from drag-start on every
    // tick; the caller threads the previous tick's absolute value through as `priorAbsoluteDelta`.
    let prior = 0;
    for (const abs of [5, 12, 20]) {
      store.dispatch(trimTickCommand("a", "right", abs, true, prior, "trim-a"));
      prior = abs;
    }
    expect(store.getSnapshot().timeline.tracks[0]!.clips.find((c) => c.id === "a")!.durationFrames).toBe(50);
    expect(store.getSnapshot().timeline.tracks[0]!.clips.find((c) => c.id === "b")!.startFrame).toBe(50);
    expect(store.canUndo()).toBe(true);
    store.undo();
    expect(store.getSnapshot().timeline.tracks[0]!.clips.find((c) => c.id === "a")!.durationFrames).toBe(30);
    expect(store.canUndo()).toBe(false);
  });
});

describe("selectForwardScopeForKey", () => {
  const base = { key: "a", shiftKey: false, metaKey: false, ctrlKey: false, altKey: false };

  test("'a' with no modifiers -> track scope", () => {
    expect(selectForwardScopeForKey(base)).toBe("track");
  });

  test("Shift+A -> allTracks scope", () => {
    expect(selectForwardScopeForKey({ ...base, key: "A", shiftKey: true })).toBe("allTracks");
  });

  test("Cmd/Ctrl/Option+A is not the shortcut", () => {
    expect(selectForwardScopeForKey({ ...base, metaKey: true })).toBeNull();
    expect(selectForwardScopeForKey({ ...base, ctrlKey: true })).toBeNull();
    expect(selectForwardScopeForKey({ ...base, altKey: true })).toBeNull();
  });

  test("a different key is not the shortcut", () => {
    expect(selectForwardScopeForKey({ ...base, key: "b" })).toBeNull();
  });
});
