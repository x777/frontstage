import { expect, test } from "vitest";
import {
  EditorStore,
  defaultTimeline,
  defaultTransform,
  defaultCrop,
  type Timeline,
  type Track,
  type Clip,
} from "@frontstage/core";
import { handleEditorKeydown } from "../src/editor/editor-shortcuts.js";

function clip(id: string, startFrame: number, durationFrames: number): Clip {
  return {
    id,
    mediaRef: "m",
    mediaType: "video",
    sourceClipType: "video",
    startFrame,
    durationFrames,
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

function tlWithClip(): Timeline {
  return {
    ...defaultTimeline(),
    tracks: [
      { id: "v", type: "video", muted: false, hidden: false, syncLocked: false, clips: [clip("a", 0, 30)] } as Track,
    ],
  };
}

function key(init: KeyboardEventInit & { target?: EventTarget }): KeyboardEvent {
  const { target, ...rest } = init;
  const e = new KeyboardEvent("keydown", rest);
  if (target) Object.defineProperty(e, "target", { value: target, configurable: true });
  return e;
}

test("Ctrl+Z undoes, Ctrl+Shift+Z redoes", () => {
  const store = new EditorStore(tlWithClip());
  store.dispatch(splitTestCommand());

  expect(store.getSnapshot().timeline.tracks[0]!.clips.length).toBe(2);

  const handledUndo = handleEditorKeydown(key({ key: "z", ctrlKey: true }), store);
  expect(handledUndo).toBe(true);
  expect(store.getSnapshot().timeline.tracks[0]!.clips.length).toBe(1);

  const handledRedo = handleEditorKeydown(key({ key: "z", ctrlKey: true, shiftKey: true }), store);
  expect(handledRedo).toBe(true);
  expect(store.getSnapshot().timeline.tracks[0]!.clips.length).toBe(2);
});

// Split-at-playhead command dispatched directly so the undo/redo test above has a real edit to
// exercise, without depending on the split shortcut it's testing separately below.
function splitTestCommand() {
  return {
    label: "test-split",
    apply(t: Timeline): Timeline {
      const track = t.tracks[0]!;
      const c = track.clips[0]!;
      const left = { ...c, durationFrames: 15 };
      const right = { ...c, id: "b", startFrame: 15, durationFrames: 15 };
      return { ...t, tracks: [{ ...track, clips: [left, right] }] };
    },
  };
}

test("Ctrl+K splits selection at playhead", () => {
  const store = new EditorStore(tlWithClip());
  store.select(["a"]);
  store.setPlayhead(15);

  const handled = handleEditorKeydown(key({ key: "k", ctrlKey: true }), store);

  expect(handled).toBe(true);
  expect(store.getSnapshot().timeline.tracks[0]!.clips.length).toBe(2);
});

test("V/C switch toolMode", () => {
  const store = new EditorStore(defaultTimeline());
  expect(store.getSnapshot().toolMode).toBe("pointer");

  expect(handleEditorKeydown(key({ key: "c" }), store)).toBe(true);
  expect(store.getSnapshot().toolMode).toBe("razor");

  expect(handleEditorKeydown(key({ key: "v" }), store)).toBe(true);
  expect(store.getSnapshot().toolMode).toBe("pointer");
});

test("Q/W trim selection to playhead", () => {
  const store = new EditorStore(tlWithClip());
  store.select(["a"]);
  store.setPlayhead(10);

  expect(handleEditorKeydown(key({ key: "q" }), store)).toBe(true);
  expect(store.getSnapshot().timeline.tracks[0]!.clips[0]!.startFrame).toBe(10);

  store.setPlayhead(20);
  expect(handleEditorKeydown(key({ key: "w" }), store)).toBe(true);
  const c = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
  expect(c.startFrame + c.durationFrames).toBe(20);
});

test("plain keys ignored when target is an input/textarea/contentEditable", () => {
  const store = new EditorStore(defaultTimeline());
  const input = document.createElement("input");
  const textarea = document.createElement("textarea");
  const editableDiv = document.createElement("div");
  Object.defineProperty(editableDiv, "isContentEditable", { value: true });

  expect(handleEditorKeydown(key({ key: "v", target: input }), store)).toBe(false);
  expect(handleEditorKeydown(key({ key: "c", target: textarea }), store)).toBe(false);
  expect(handleEditorKeydown(key({ key: "v", target: editableDiv }), store)).toBe(false);
  expect(store.getSnapshot().toolMode).toBe("pointer");

  const handledCtrlZ = handleEditorKeydown(key({ key: "z", ctrlKey: true, target: input }), store);
  expect(handledCtrlZ).toBe(false);
});

test("plain keys ignored with meta/alt held", () => {
  const store = new EditorStore(defaultTimeline());

  expect(handleEditorKeydown(key({ key: "v", altKey: true }), store)).toBe(false);
  expect(handleEditorKeydown(key({ key: "v", metaKey: true }), store)).toBe(false);
  expect(handleEditorKeydown(key({ key: "z", ctrlKey: true, altKey: true }), store)).toBe(false);
  expect(store.getSnapshot().toolMode).toBe("pointer");
});
