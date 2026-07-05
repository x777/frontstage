import { render, screen, fireEvent, act } from "@testing-library/react";
import { CurvesSection } from "../src/inspector/adjust/index.js";
import { EditorStore, defaultTimeline, defaultTransform, defaultCrop, parseGradeCurve } from "@frontstage/core";
import type { Clip, Track } from "@frontstage/core";

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

test("CurvesSection renders Y/R/G/B channel picker buttons when expanded", () => {
  const store = new EditorStore(makeTimeline([makeClip("c1")]));
  render(<CurvesSection store={store} clipIds={["c1"]} />);
  // Expand the section
  act(() => { fireEvent.click(screen.getByTestId("adjust-section-Curves")); });
  expect(screen.getByTestId("curve-channel-master")).toBeInTheDocument();
  expect(screen.getByTestId("curve-channel-red")).toBeInTheDocument();
  expect(screen.getByTestId("curve-channel-green")).toBeInTheDocument();
  expect(screen.getByTestId("curve-channel-blue")).toBeInTheDocument();
});

test("Y (master) channel button is active by default", () => {
  const store = new EditorStore(makeTimeline([makeClip("c1")]));
  render(<CurvesSection store={store} clipIds={["c1"]} />);
  act(() => { fireEvent.click(screen.getByTestId("adjust-section-Curves")); });
  expect(screen.getByTestId("curve-channel-master")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("curve-channel-red")).toHaveAttribute("aria-pressed", "false");
});

test("add-point button dispatches color.curves effect with non-identity master channel", () => {
  const store = new EditorStore(makeTimeline([makeClip("c1")]));
  render(<CurvesSection store={store} clipIds={["c1"]} />);
  act(() => { fireEvent.click(screen.getByTestId("adjust-section-Curves")); });

  // Drive edit via testable button path (no canvas geometry needed in jsdom)
  act(() => { fireEvent.click(screen.getByTestId("curve-add-point")); });

  const clip = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
  const curvesEffect = clip.effects?.find((e) => e.type === "color.curves");
  expect(curvesEffect).toBeDefined();

  const curveStr = curvesEffect?.params["curve"]?.string ?? "";
  expect(curveStr).not.toBe("");

  const parsed = parseGradeCurve(curveStr);
  // Master should have >2 points (we added one at 0.5,0.75 on top of the 2 identity endpoints)
  expect(parsed.master.length).toBeGreaterThan(2);
  // Other channels untouched — identity (empty)
  expect(parsed.red.length).toBe(0);
  expect(parsed.green.length).toBe(0);
  expect(parsed.blue.length).toBe(0);
});

test("switching channel button to R updates aria-pressed state", () => {
  const store = new EditorStore(makeTimeline([makeClip("c1")]));
  render(<CurvesSection store={store} clipIds={["c1"]} />);
  act(() => { fireEvent.click(screen.getByTestId("adjust-section-Curves")); });

  act(() => { fireEvent.click(screen.getByTestId("curve-channel-red")); });

  expect(screen.getByTestId("curve-channel-red")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("curve-channel-master")).toHaveAttribute("aria-pressed", "false");
});

test("add-point on red channel after switching writes to red, not master", () => {
  const store = new EditorStore(makeTimeline([makeClip("c1")]));
  render(<CurvesSection store={store} clipIds={["c1"]} />);
  act(() => { fireEvent.click(screen.getByTestId("adjust-section-Curves")); });
  act(() => { fireEvent.click(screen.getByTestId("curve-channel-red")); });
  act(() => { fireEvent.click(screen.getByTestId("curve-add-point")); });

  const clip = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
  const curveStr = clip.effects?.find((e) => e.type === "color.curves")?.params["curve"]?.string ?? "";
  const parsed = parseGradeCurve(curveStr);
  expect(parsed.red.length).toBeGreaterThan(2);
  expect(parsed.master.length).toBe(0);
});

test("reset button removes color.curves effect", () => {
  const store = new EditorStore(makeTimeline([makeClip("c1")]));
  render(<CurvesSection store={store} clipIds={["c1"]} />);
  act(() => { fireEvent.click(screen.getByTestId("adjust-section-Curves")); });

  // Add a point so the effect exists
  act(() => { fireEvent.click(screen.getByTestId("curve-add-point")); });
  const before = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
  expect(before.effects?.some((e) => e.type === "color.curves")).toBe(true);

  // Reset — button only appears when canReset=true (effect present)
  act(() => { fireEvent.click(screen.getByTestId("adjust-section-reset-Curves")); });
  const after = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
  expect(after.effects?.some((e) => e.type === "color.curves") ?? false).toBe(false);
});

test("CurvesSection section is collapsed by default", () => {
  const store = new EditorStore(makeTimeline([makeClip("c1")]));
  render(<CurvesSection store={store} clipIds={["c1"]} />);
  // Channel buttons are not rendered when collapsed
  expect(screen.queryByTestId("curve-channel-master")).not.toBeInTheDocument();
});

test("toggling enable checkbox flips color.curves effect enabled state", () => {
  const store = new EditorStore(makeTimeline([makeClip("c1")]));
  render(<CurvesSection store={store} clipIds={["c1"]} />);
  act(() => { fireEvent.click(screen.getByTestId("adjust-section-Curves")); });

  // Add a point so the color.curves effect exists (enables the checkbox)
  act(() => { fireEvent.click(screen.getByTestId("curve-add-point")); });

  const before = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
  expect(before.effects?.find((e) => e.type === "color.curves")?.enabled).toBe(true);

  act(() => { fireEvent.click(screen.getByTestId("adjust-section-enable-Curves")); });

  const after = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
  expect(after.effects?.find((e) => e.type === "color.curves")?.enabled).toBe(false);
});
