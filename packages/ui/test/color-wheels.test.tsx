import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { ColorWheelsSection } from "../src/inspector/adjust/index.js";
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

test("ColorWheelsSection renders Lift/Gamma/Gain titles when expanded", () => {
  const store = new EditorStore(makeTimeline([makeClip("c1")]));
  render(<ColorWheelsSection store={store} clipIds={["c1"]} />);
  // Section is collapsed by default — expand it
  act(() => { fireEvent.click(screen.getByTestId("adjust-section-Color Wheels")); });
  expect(screen.getByText("Lift")).toBeInTheDocument();
  expect(screen.getByText("Gamma")).toBeInTheDocument();
  expect(screen.getByText("Gain")).toBeInTheDocument();
});

test("ArrowRight on Lift pad dispatches color.wheels effect with non-zero lift_x or lift_y", () => {
  const store = new EditorStore(makeTimeline([makeClip("c1")]));
  render(<ColorWheelsSection store={store} clipIds={["c1"]} />);
  act(() => { fireEvent.click(screen.getByTestId("adjust-section-Color Wheels")); });

  // The pad has role="slider" and aria-label="Lift"
  const liftPad = screen.getByRole("slider", { name: "Lift" });
  act(() => { fireEvent.keyDown(liftPad, { key: "ArrowRight" }); });

  const clip = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
  const wheelsEffect = clip.effects?.find((e) => e.type === "color.wheels");
  expect(wheelsEffect).toBeDefined();
  const liftX = wheelsEffect?.params.lift_x?.value ?? 0;
  const liftY = wheelsEffect?.params.lift_y?.value ?? 0;
  expect(Math.abs(liftX) + Math.abs(liftY)).toBeGreaterThan(0);
});

test("2-clip selection with differing gamma_m shows — on Gamma luma field", () => {
  const clip1: Clip = {
    ...makeClip("c1"),
    effects: [{
      id: "e1",
      type: "color.wheels",
      enabled: true,
      params: {
        lift_x: { value: 0 }, lift_y: { value: 0 }, lift_m: { value: 0 },
        gamma_x: { value: 0 }, gamma_y: { value: 0 }, gamma_m: { value: 1.5 },
        gain_x: { value: 0 }, gain_y: { value: 0 }, gain_m: { value: 1 },
      },
    }],
  };
  const clip2 = makeClip("c2"); // no effects → gamma_m defaults to 1
  const store = new EditorStore(makeTimeline([clip1, clip2]));
  render(<ColorWheelsSection store={store} clipIds={["c1", "c2"]} />);
  act(() => { fireEvent.click(screen.getByTestId("adjust-section-Color Wheels")); });

  const gammaControl = screen.getByTestId("wheel-control-gamma");
  const gammaLuma = within(gammaControl).getByTestId("wheel-luma-gamma");
  expect(within(gammaLuma).getByText("—")).toBeInTheDocument();
});
