import { expect, test, vi } from "vitest";
import { render, fireEvent, screen, act } from "@testing-library/react";
import {
  EditorStore,
  defaultTimeline,
  defaultTransform,
  defaultCrop,
  ZOOM_MIN,
  ZOOM_MAX,
  type Timeline,
  type Track,
  type Clip,
} from "@palmier/core";
import { Toolbar } from "../src/toolbar/Toolbar.js";

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

test("undo/redo buttons call store.undo/redo", () => {
  const store = new EditorStore(defaultTimeline());
  const undoSpy = vi.spyOn(store, "undo");
  const redoSpy = vi.spyOn(store, "redo");
  render(<Toolbar store={store} />);
  fireEvent.click(screen.getByTestId("toolbar-undo"));
  fireEvent.click(screen.getByTestId("toolbar-redo"));
  expect(undoSpy).toHaveBeenCalledTimes(1);
  expect(redoSpy).toHaveBeenCalledTimes(1);
});

test("pointer/razor buttons switch toolMode with active state", () => {
  const store = new EditorStore(defaultTimeline());
  render(<Toolbar store={store} />);
  expect(screen.getByTestId("toolbar-pointer")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("toolbar-razor")).toHaveAttribute("aria-pressed", "false");

  fireEvent.click(screen.getByTestId("toolbar-razor"));

  expect(store.getSnapshot().toolMode).toBe("razor");
  expect(screen.getByTestId("toolbar-razor")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("toolbar-pointer")).toHaveAttribute("aria-pressed", "false");
});

test("tool-mode buttons rest at tertiary tone (ToolbarView.toolModeButton)", () => {
  const store = new EditorStore(defaultTimeline());
  render(<Toolbar store={store} />);
  // pointer is active (primary); razor rests at the tertiary tone
  expect(screen.getByTestId("toolbar-razor").style.color).toBe("var(--text-tertiary)");
});

test("split/trim buttons disable when the action would no-op", () => {
  const store = new EditorStore(tlWithClip());
  render(<Toolbar store={store} />);
  // no selection → disabled
  expect(screen.getByTestId("toolbar-split")).toBeDisabled();
  expect(screen.getByTestId("toolbar-trim-start")).toBeDisabled();
  expect(screen.getByTestId("toolbar-trim-end")).toBeDisabled();
  // selected but playhead at the clip edge (0) → still disabled (strictly-inside rule)
  act(() => store.select(["a"]));
  expect(screen.getByTestId("toolbar-split")).toBeDisabled();
  // playhead strictly inside → enabled
  act(() => store.setPlayhead(15));
  expect(screen.getByTestId("toolbar-split")).toBeEnabled();
  expect(screen.getByTestId("toolbar-trim-start")).toBeEnabled();
  expect(screen.getByTestId("toolbar-trim-end")).toBeEnabled();
});

test("split button dispatches at store.playhead for the selection", () => {
  const store = new EditorStore(tlWithClip());
  store.select(["a"]);
  store.setPlayhead(15);
  render(<Toolbar store={store} />);

  fireEvent.click(screen.getByTestId("toolbar-split"));

  expect(store.getSnapshot().timeline.tracks[0]!.clips.length).toBe(2);
});

test("trim-start button trims the selected clip's start to the playhead", () => {
  const store = new EditorStore(tlWithClip());
  store.select(["a"]);
  store.setPlayhead(10);
  render(<Toolbar store={store} />);

  fireEvent.click(screen.getByTestId("toolbar-trim-start"));

  expect(store.getSnapshot().timeline.tracks[0]!.clips[0]!.startFrame).toBe(10);
});

test("trim-end button trims the selected clip's end to the playhead", () => {
  const store = new EditorStore(tlWithClip());
  store.select(["a"]);
  store.setPlayhead(20);
  render(<Toolbar store={store} />);

  fireEvent.click(screen.getByTestId("toolbar-trim-end"));

  const c = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
  expect(c.startFrame + c.durationFrames).toBe(20);
});

test("T button adds a text clip and selects it", () => {
  const store = new EditorStore(defaultTimeline());
  store.setPlayhead(0);
  render(<Toolbar store={store} />);

  fireEvent.click(screen.getByTestId("toolbar-add-text"));

  const snap = store.getSnapshot();
  expect(snap.timeline.tracks.length).toBe(1);
  const newClip = snap.timeline.tracks[0]!.clips[0]!;
  expect(newClip.textContent).toBe("Text");
  expect([...snap.selection]).toEqual([newClip.id]);
});

test("zoom +/- step by 1.25 and clamp+disable at bounds", () => {
  const store = new EditorStore(defaultTimeline());
  render(<Toolbar store={store} />);

  fireEvent.click(screen.getByTestId("toolbar-zoom-in"));
  expect(store.getSnapshot().view.zoom).toBeCloseTo(1.25);

  fireEvent.click(screen.getByTestId("toolbar-zoom-out"));
  expect(store.getSnapshot().view.zoom).toBeCloseTo(1);

  act(() => store.setZoom(ZOOM_MAX));
  expect(screen.getByTestId("toolbar-zoom-in")).toBeDisabled();

  act(() => store.setZoom(ZOOM_MIN));
  expect(screen.getByTestId("toolbar-zoom-out")).toBeDisabled();
});

test("zoom slider is log-mapped", () => {
  const store = new EditorStore(defaultTimeline());
  render(<Toolbar store={store} />);
  const slider = screen.getByTestId("toolbar-zoom-slider");

  fireEvent.change(slider, { target: { value: String(Math.log(4)) } });

  expect(store.getSnapshot().view.zoom).toBeCloseTo(4);
});
