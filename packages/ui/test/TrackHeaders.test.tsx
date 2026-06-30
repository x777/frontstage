import { render, screen, act, fireEvent } from "@testing-library/react";
import { EditorStore, defaultTimeline, type Timeline, type Track } from "@palmier/core";
import { TrackHeaders } from "../src/timeline/TrackHeaders.js";

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
