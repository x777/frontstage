import { render, screen, act, fireEvent } from "@testing-library/react";
import { EditorStore, defaultTimeline, defaultTransform, defaultCrop, type Timeline, type Track, type Clip } from "@frontstage/core";
import { ClipContextMenu } from "../src/timeline/ClipContextMenu.js";

function clip(id: string, mediaType: Clip["mediaType"], linkGroupId?: string): Clip {
  return {
    id, mediaRef: "m", mediaType, sourceClipType: mediaType === "audio" ? "video" : "video",
    startFrame: 0, durationFrames: 30, trimStartFrame: 0, trimEndFrame: 0, speed: 1, volume: 1,
    fadeInFrames: 0, fadeOutFrames: 0, fadeInInterpolation: "linear", fadeOutInterpolation: "linear",
    opacity: 1, transform: defaultTransform(), crop: defaultCrop(), linkGroupId,
  };
}
function tl(): Timeline {
  return {
    ...defaultTimeline(),
    tracks: [
      { id: "v", type: "video", muted: false, hidden: false, syncLocked: false, clips: [clip("a", "video")] } as Track,
      { id: "au", type: "audio", muted: false, hidden: false, syncLocked: false, clips: [clip("b", "audio")] } as Track,
    ],
  };
}

test("Link is enabled for a 2-type selection and links on click", () => {
  const store = new EditorStore(tl());
  store.select(["a", "b"]);
  render(<ClipContextMenu store={store} menu={{ x: 10, y: 10 }} onClose={() => {}} />);
  const link = screen.getByTestId("ctx-link");
  expect(link).not.toBeDisabled();
  act(() => { fireEvent.click(link); });
  const g = store.getSnapshot().timeline.tracks[0]!.clips[0]!.linkGroupId;
  expect(g).toBeDefined();
  expect(store.getSnapshot().timeline.tracks[1]!.clips[0]!.linkGroupId).toBe(g);
});

test("Unlink is disabled when nothing is linked, enabled once linked", () => {
  const store = new EditorStore(tl());
  store.select(["a"]);
  const { rerender } = render(<ClipContextMenu store={store} menu={{ x: 0, y: 0 }} onClose={() => {}} />);
  expect(screen.getByTestId("ctx-unlink")).toBeDisabled();
  act(() => { store.select(["a", "b"]); }); // link them via the action path
  // simulate a linked state directly:
  store.dispatch({ label: "t", apply: (t) => ({ ...t, tracks: t.tracks.map((tr) => ({ ...tr, clips: tr.clips.map((c) => ({ ...c, linkGroupId: "g" })) })) }) });
  rerender(<ClipContextMenu store={store} menu={{ x: 0, y: 0 }} onClose={() => {}} />);
  expect(screen.getByTestId("ctx-unlink")).not.toBeDisabled();
});

test("renders nothing when menu is null", () => {
  const store = new EditorStore(tl());
  const { container } = render(<ClipContextMenu store={store} menu={null} onClose={() => {}} />);
  expect(container.firstChild).toBeNull();
});

test("Select Forward items are disabled when the menu has no clipId (e.g. a stale call site)", () => {
  const store = new EditorStore(tl());
  render(<ClipContextMenu store={store} menu={{ x: 0, y: 0 }} onClose={() => {}} />);
  expect(screen.getByTestId("ctx-select-forward-track")).toBeDisabled();
  expect(screen.getByTestId("ctx-select-forward-all")).toBeDisabled();
});

test("Select Forward on Track anchors on the right-clicked clip, not the current selection", () => {
  const store = new EditorStore(tl());
  store.select(["a"]); // "a" is on track 0, at frame 0
  // clip("b", "audio") sits on track 1 at frame 0 too — right-click it directly.
  render(<ClipContextMenu store={store} menu={{ x: 0, y: 0, clipId: "b" }} onClose={() => {}} />);
  const btn = screen.getByTestId("ctx-select-forward-track");
  expect(btn).not.toBeDisabled();
  act(() => { fireEvent.click(btn); });
  expect([...store.getSnapshot().selection]).toEqual(["b"]); // only b's own track, from its own frame
});

test("Select Forward on All Tracks reaches every track from the right-clicked clip's frame", () => {
  const store = new EditorStore(tl());
  render(<ClipContextMenu store={store} menu={{ x: 0, y: 0, clipId: "a" }} onClose={() => {}} />);
  act(() => { fireEvent.click(screen.getByTestId("ctx-select-forward-all")); });
  expect([...store.getSnapshot().selection].sort()).toEqual(["a", "b"]); // both at frame 0
});
