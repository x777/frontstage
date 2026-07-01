import { render, screen, fireEvent, act } from "@testing-library/react";
import { BlendControl } from "../src/inspector/adjust/BlendControl.js";
import { EditorStore, defaultTimeline, defaultTransform, defaultCrop } from "@palmier/core";
import type { Clip, Track } from "@palmier/core";

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

function makeTimeline(clips: Clip[]) {
  const track: Track = { id: "t1", type: "video", muted: false, hidden: false, syncLocked: false, clips };
  return { ...defaultTimeline(), tracks: [track] };
}

test("BlendControl renders a select showing Normal for a clip with no blend mode", () => {
  const store = new EditorStore(makeTimeline([makeClip("c1")]));
  render(<BlendControl store={store} clipIds={["c1"]} />);
  expect(screen.getByRole("combobox")).toHaveDisplayValue("Normal");
});

test("BlendControl fireEvent.change to multiply sets clip.blendMode to multiply", () => {
  const store = new EditorStore(makeTimeline([makeClip("c1")]));
  render(<BlendControl store={store} clipIds={["c1"]} />);
  const select = screen.getByRole("combobox");
  act(() => { fireEvent.change(select, { target: { value: "multiply" } }); });
  const clip = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
  expect(clip.blendMode).toBe("multiply");
});

test("BlendControl changing to normal clears blendMode to undefined", () => {
  const clip: Clip = { ...makeClip("c1"), blendMode: "multiply" };
  const store = new EditorStore(makeTimeline([clip]));
  render(<BlendControl store={store} clipIds={["c1"]} />);
  const select = screen.getByRole("combobox");
  act(() => { fireEvent.change(select, { target: { value: "normal" } }); });
  const updated = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
  expect(updated.blendMode).toBeUndefined();
});

test("BlendControl shows — placeholder for mixed blend modes across 2 clips", () => {
  const clip1: Clip = { ...makeClip("c1"), blendMode: "multiply" };
  const clip2: Clip = { ...makeClip("c2"), blendMode: "screen" };
  const store = new EditorStore(makeTimeline([clip1, clip2]));
  render(<BlendControl store={store} clipIds={["c1", "c2"]} />);
  expect(screen.getByRole("combobox")).toHaveDisplayValue("—");
});
