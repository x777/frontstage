import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { EffectsSection } from "../src/inspector/adjust/index.js";
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

const SUBGROUP_TITLES = ["Detail", "Blur", "Motion Blur", "Vignette", "Film Grain", "Glow", "Chroma Key"];

test("EffectsSection renders all 7 subgroup titles", () => {
  const store = new EditorStore(makeTimeline([makeClip("c1")]));
  render(<EffectsSection store={store} clipIds={["c1"]} />);
  for (const title of SUBGROUP_TITLES) {
    expect(screen.getByTestId(`adjust-section-${title}`)).toBeInTheDocument();
  }
});

test("EffectsSection: expanding Blur shows Radius row", () => {
  const store = new EditorStore(makeTimeline([makeClip("c1")]));
  render(<EffectsSection store={store} clipIds={["c1"]} />);
  // Blur is collapsed by default — no Radius row yet
  expect(screen.queryByTestId("adjustment-row-Radius")).not.toBeInTheDocument();
  act(() => { fireEvent.click(screen.getByTestId("adjust-section-Blur")); });
  expect(screen.getByTestId("adjustment-row-Radius")).toBeInTheDocument();
});

test("EffectsSection: ArrowRight on Blur Radius slider dispatches blur.gaussian with non-default radius", () => {
  const store = new EditorStore(makeTimeline([makeClip("c1")]));
  render(<EffectsSection store={store} clipIds={["c1"]} />);
  act(() => { fireEvent.click(screen.getByTestId("adjust-section-Blur")); });
  const radiusRow = screen.getByTestId("adjustment-row-Radius");
  const slider = within(radiusRow).getByRole("slider");
  act(() => { fireEvent.keyDown(slider, { key: "ArrowRight" }); });
  const clip = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
  const effect = clip.effects?.find((e) => e.type === "blur.gaussian");
  expect(effect).toBeDefined();
  // default radius = 8; ArrowRight adds (100-0)*0.01 = 1 → 9
  expect(effect?.params.radius?.value).toBeGreaterThan(8);
});

test("EffectsSection: 2-clip selection with differing blur.gaussian radius shows — on Radius row", () => {
  const clip1: Clip = {
    ...makeClip("c1"),
    effects: [{ id: "e1", type: "blur.gaussian", enabled: true, params: { radius: { value: 10 } } }],
  };
  const clip2: Clip = {
    ...makeClip("c2"),
    effects: [{ id: "e2", type: "blur.gaussian", enabled: true, params: { radius: { value: 20 } } }],
  };
  const store = new EditorStore(makeTimeline([clip1, clip2]));
  render(<EffectsSection store={store} clipIds={["c1", "c2"]} />);
  act(() => { fireEvent.click(screen.getByTestId("adjust-section-Blur")); });
  const radiusRow = screen.getByTestId("adjustment-row-Radius");
  expect(within(radiusRow).getByText("—")).toBeInTheDocument();
});
