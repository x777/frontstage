import { render, screen, act, fireEvent } from "@testing-library/react";
import { EditorStore, defaultTimeline, type Timeline, type Track } from "@frontstage/core";
import { TrackHeaders } from "../src/timeline/TrackHeaders.js";

// jsdom has no PointerEvent (as of jsdom 24), so @testing-library/dom's fireEvent.pointer* falls
// back to the base `Event` constructor, which silently drops clientX/clientY/pointerId from the
// init dict. Polyfill a minimal PointerEvent (MouseEvent + pointerId) so those init props survive.
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

function track(id: string, type: Track["type"]): Track {
  return { id, type, muted: false, hidden: false, syncLocked: false, clips: [] };
}
function tl(types: Track["type"][]): Timeline {
  return { ...defaultTimeline(), tracks: types.map((t, i) => track(`${t}${i}`, t)) };
}

test("renders one header row per track", () => {
  const store = new EditorStore(tl(["video", "audio"]));
  render(<TrackHeaders store={store} />);
  expect(screen.getAllByTestId("track-header-row")).toHaveLength(2);
});

test("mute button toggles an audio track's muted flag (one undo step)", () => {
  const store = new EditorStore(tl(["audio"]));
  render(<TrackHeaders store={store} />);
  act(() => { fireEvent.click(screen.getByTestId("track-mute-audio0")); });
  expect(store.getSnapshot().timeline.tracks[0]!.muted).toBe(true);
  expect(store.canUndo()).toBe(true);
});

test("hide button toggles a visual track's hidden flag", () => {
  const store = new EditorStore(tl(["video"]));
  render(<TrackHeaders store={store} />);
  act(() => { fireEvent.click(screen.getByTestId("track-hide-video0")); });
  expect(store.getSnapshot().timeline.tracks[0]!.hidden).toBe(true);
});

test("syncLock button toggles the syncLocked flag", () => {
  const store = new EditorStore(tl(["video"]));
  render(<TrackHeaders store={store} />);
  act(() => { fireEvent.click(screen.getByTestId("track-synclock-video0")); });
  expect(store.getSnapshot().timeline.tracks[0]!.syncLocked).toBe(true);
});

test("dragging a track's grip handle down reorders it live and coalesces to one undo on release", () => {
  const store = new EditorStore(tl(["video", "video", "video"]));
  render(<TrackHeaders store={store} />);
  const grip = screen.getByTestId("track-grip-video0");

  // jsdom has no layout engine — getBoundingClientRect() on the header list returns a zeroed
  // rect, so clientY IS the position relative to the list's top (DEFAULT_TRACK_HEIGHT=50/row).
  act(() => { fireEvent.pointerDown(grip, { clientX: 5, clientY: 5, pointerId: 1 }); });
  act(() => { fireEvent.pointerMove(grip, { clientX: 5, clientY: 120, pointerId: 1 }); }); // row 2 (floor(120/50))
  expect(store.getSnapshot().timeline.tracks.map((t) => t.id)).toEqual(["video1", "video2", "video0"]);
  expect(store.canUndo()).toBe(true); // live reorder already reflects in one coalesced step

  act(() => { fireEvent.pointerMove(grip, { clientX: 5, clientY: 60, pointerId: 1 }); }); // back to row 1
  expect(store.getSnapshot().timeline.tracks.map((t) => t.id)).toEqual(["video1", "video0", "video2"]);

  act(() => { fireEvent.pointerUp(grip, { clientX: 5, clientY: 60, pointerId: 1 }); });
  expect(store.canUndo()).toBe(true);
  act(() => { store.undo(); });
  expect(store.getSnapshot().timeline.tracks.map((t) => t.id)).toEqual(["video0", "video1", "video2"]); // one undo, pre-drag order
  expect(store.canUndo()).toBe(false);
});

test("a pointermove while not the dragged track's own grip does not reorder", () => {
  const store = new EditorStore(tl(["video", "video"]));
  render(<TrackHeaders store={store} />);
  // No pointerdown first — a stray move on the grip should be a no-op.
  act(() => { fireEvent.pointerMove(screen.getByTestId("track-grip-video1"), { clientX: 5, clientY: 5, pointerId: 1 }); });
  expect(store.getSnapshot().timeline.tracks.map((t) => t.id)).toEqual(["video0", "video1"]);
  expect(store.canUndo()).toBe(false);
});

test("starting a grip drag clears a selected gap (its trackIndex could go stale mid-reorder)", () => {
  const store = new EditorStore(tl(["video", "video"]));
  render(<TrackHeaders store={store} />);
  act(() => { store.setSelectedGap({ trackIndex: 0, range: { start: 0, end: 10 } }); });
  expect(store.getSnapshot().selectedGap).not.toBeNull();
  act(() => { fireEvent.pointerDown(screen.getByTestId("track-grip-video0"), { clientX: 5, clientY: 5, pointerId: 1 }); });
  expect(store.getSnapshot().selectedGap).toBeNull();
});
