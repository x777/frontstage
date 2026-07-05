/**
 * M17C T2 — razor-mode interaction. Mount/fixture idiom copied from TrackHeaders.test.tsx: jsdom
 * has no PointerEvent (as of jsdom 24) and no layout engine, so getBoundingClientRect() on the
 * canvas returns a zeroed rect — clientX/clientY map directly onto TimelinePanel's own geometry
 * (which already bakes in TRACK_HEADER_WIDTH/RULER_HEIGHT offsets), same trick as that file.
 */
import { render, screen, act, fireEvent } from "@testing-library/react";
import {
  EditorStore,
  defaultTimeline,
  defaultTransform,
  defaultCrop,
  type Timeline,
  type Track,
  type Clip,
} from "@frontstage/core";
import { TimelinePanel } from "../src/timeline/TimelinePanel.js";

if (typeof (globalThis as { PointerEvent?: unknown }).PointerEvent === "undefined") {
  class FakePointerEvent extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: MouseEventInit & { pointerId?: number } = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  (globalThis as { PointerEvent?: unknown }).PointerEvent = FakePointerEvent;
}

// jsdom doesn't implement the Pointer Capture API at all — TimelinePanel's pointer-mode gestures
// call setPointerCapture/releasePointerCapture unconditionally (unlike TrackHeaders' `?.()` calls).
if (typeof HTMLElement.prototype.setPointerCapture !== "function") {
  HTMLElement.prototype.setPointerCapture = function () {};
  HTMLElement.prototype.releasePointerCapture = function () {};
}

// jsdom has no ResizeObserver — TimelinePanel's mount effect creates one unconditionally.
if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === "undefined") {
  class FakeResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
}

function clip(id: string, over: Partial<Clip> = {}): Clip {
  return {
    id,
    mediaRef: "m",
    mediaType: "video",
    sourceClipType: "video",
    startFrame: 0,
    durationFrames: 60,
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
    ...over,
  };
}
function track(id: string, type: Track["type"], clips: Clip[]): Track {
  return { id, type, muted: false, hidden: false, syncLocked: false, clips };
}
// Linked A/V pair spanning frames 0..60 on separate tracks — zoom=1 (default) means
// pixelsPerFrame=1, so with TRACK_HEADER_WIDTH=100 the clip occupies screen x in [100,160].
function linkedTimeline(): Timeline {
  return {
    ...defaultTimeline(),
    tracks: [
      track("vt", "video", [clip("v", { linkGroupId: "g" })]),
      track("at", "audio", [clip("a", { linkGroupId: "g", mediaType: "audio" })]),
    ],
  };
}

function renderPanel(store: EditorStore): HTMLCanvasElement {
  render(<TimelinePanel store={store} />);
  return screen.getByTestId("timeline-canvas") as HTMLCanvasElement;
}

// x=130 -> frame 30 (strictly inside the 0..60 clip); y=30 -> inside track 0's row (RULER_HEIGHT=24,
// DEFAULT_TRACK_HEIGHT=50), clear of the 4px trim-handle zones at the clip's left/right edges.
const CLIP_X = 130;
const CLIP_Y = 30;

test("razor click on a clip splits it (linked partner follows) — one undo step", () => {
  const store = new EditorStore(linkedTimeline());
  store.setToolMode("razor");
  const canvas = renderPanel(store);

  act(() => {
    fireEvent.pointerDown(canvas, { clientX: CLIP_X, clientY: CLIP_Y, pointerId: 1 });
  });

  const tl = store.getSnapshot().timeline;
  expect(tl.tracks[0]!.clips).toHaveLength(2);
  expect(tl.tracks[1]!.clips).toHaveLength(2);
  expect(store.canUndo()).toBe(true);

  act(() => {
    store.undo();
  });
  const restored = store.getSnapshot().timeline;
  expect(restored.tracks[0]!.clips).toHaveLength(1);
  expect(restored.tracks[1]!.clips).toHaveLength(1);
  expect(store.canUndo()).toBe(false);
});

test("razor click does NOT change selection", () => {
  const store = new EditorStore(linkedTimeline());
  store.setToolMode("razor");
  const canvas = renderPanel(store);

  act(() => {
    fireEvent.pointerDown(canvas, { clientX: CLIP_X, clientY: CLIP_Y, pointerId: 1 });
  });

  expect(store.getSnapshot().selection.size).toBe(0);
});

test("razor click on empty area does nothing", () => {
  const store = new EditorStore(linkedTimeline());
  store.setToolMode("razor");
  const canvas = renderPanel(store);

  // x=500 is well past the clip's right edge (160) -> "empty" hit on track 0's row.
  act(() => {
    fireEvent.pointerDown(canvas, { clientX: 500, clientY: CLIP_Y, pointerId: 1 });
  });

  const tl = store.getSnapshot().timeline;
  expect(tl.tracks[0]!.clips).toHaveLength(1);
  expect(tl.tracks[1]!.clips).toHaveLength(1);
  expect(store.canUndo()).toBe(false);
  expect(store.getSnapshot().selection.size).toBe(0); // no marquee selection started either
});

test("pointer-mode click still selects (razor branch inert)", () => {
  const store = new EditorStore(linkedTimeline()); // toolMode defaults to "pointer"
  const canvas = renderPanel(store);

  act(() => {
    fireEvent.pointerDown(canvas, { clientX: CLIP_X, clientY: CLIP_Y, pointerId: 1 });
  });

  expect(store.getSnapshot().selection.has("v")).toBe(true);
  const tl = store.getSnapshot().timeline;
  expect(tl.tracks[0]!.clips).toHaveLength(1); // no split — regression pin
});

test("canvas cursor is crosshair in razor mode and default in pointer mode", () => {
  const store = new EditorStore(linkedTimeline());
  const canvas = renderPanel(store);
  expect(canvas.style.cursor).not.toBe("crosshair");

  act(() => {
    store.setToolMode("razor");
  });
  expect(canvas.style.cursor).toBe("crosshair");

  act(() => {
    store.setToolMode("pointer");
  });
  expect(canvas.style.cursor).not.toBe("crosshair");
});
