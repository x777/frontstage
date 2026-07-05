import { render, screen, fireEvent, act } from "@testing-library/react";
import { HueCurvesSection } from "../src/inspector/adjust/index.js";
import { EditorStore, defaultTimeline, defaultTransform, defaultCrop, parseHueCurves } from "@frontstage/core";
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

test("HueCurvesSection renders Hue/Sat/Luma channel picker when expanded", () => {
  const store = new EditorStore(makeTimeline([makeClip("c1")]));
  render(<HueCurvesSection store={store} clipIds={["c1"]} />);
  act(() => { fireEvent.click(screen.getByTestId("adjust-section-Hue Curves")); });
  expect(screen.getByTestId("hue-curve-channel-hueVsHue")).toBeInTheDocument();
  expect(screen.getByTestId("hue-curve-channel-hueVsSat")).toBeInTheDocument();
  expect(screen.getByTestId("hue-curve-channel-hueVsLum")).toBeInTheDocument();
});

test("Hue channel button is active by default", () => {
  const store = new EditorStore(makeTimeline([makeClip("c1")]));
  render(<HueCurvesSection store={store} clipIds={["c1"]} />);
  act(() => { fireEvent.click(screen.getByTestId("adjust-section-Hue Curves")); });
  expect(screen.getByTestId("hue-curve-channel-hueVsHue")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("hue-curve-channel-hueVsSat")).toHaveAttribute("aria-pressed", "false");
});

test("add-point button dispatches color.hueCurves effect with non-neutral hueVsHue", () => {
  const store = new EditorStore(makeTimeline([makeClip("c1")]));
  render(<HueCurvesSection store={store} clipIds={["c1"]} />);
  act(() => { fireEvent.click(screen.getByTestId("adjust-section-Hue Curves")); });
  act(() => { fireEvent.click(screen.getByTestId("hue-curve-add-point")); });

  const clip = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
  const effect = clip.effects?.find((e) => e.type === "color.hueCurves");
  expect(effect).toBeDefined();

  const curvesStr = effect?.params["curves"]?.string ?? "";
  expect(curvesStr).not.toBe("");

  const parsed = parseHueCurves(curvesStr);
  expect(parsed.hueVsHue.length).toBeGreaterThan(0);
  expect(parsed.hueVsHue.some((p) => Math.abs(p.y - 0.5) > 0.1)).toBe(true);
  expect(parsed.hueVsSat.length).toBe(0);
  expect(parsed.hueVsLum.length).toBe(0);
});

test("switching channel to Sat updates aria-pressed", () => {
  const store = new EditorStore(makeTimeline([makeClip("c1")]));
  render(<HueCurvesSection store={store} clipIds={["c1"]} />);
  act(() => { fireEvent.click(screen.getByTestId("adjust-section-Hue Curves")); });
  act(() => { fireEvent.click(screen.getByTestId("hue-curve-channel-hueVsSat")); });
  expect(screen.getByTestId("hue-curve-channel-hueVsSat")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("hue-curve-channel-hueVsHue")).toHaveAttribute("aria-pressed", "false");
});

test("add-point on hueVsSat channel writes to hueVsSat, not hueVsHue", () => {
  const store = new EditorStore(makeTimeline([makeClip("c1")]));
  render(<HueCurvesSection store={store} clipIds={["c1"]} />);
  act(() => { fireEvent.click(screen.getByTestId("adjust-section-Hue Curves")); });
  act(() => { fireEvent.click(screen.getByTestId("hue-curve-channel-hueVsSat")); });
  act(() => { fireEvent.click(screen.getByTestId("hue-curve-add-point")); });

  const clip = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
  const curvesStr = clip.effects?.find((e) => e.type === "color.hueCurves")?.params["curves"]?.string ?? "";
  const parsed = parseHueCurves(curvesStr);
  expect(parsed.hueVsSat.some((p) => Math.abs(p.y - 0.5) > 0.1)).toBe(true);
  expect(parsed.hueVsHue.length).toBe(0);
});

test("reset button removes color.hueCurves effect", () => {
  const store = new EditorStore(makeTimeline([makeClip("c1")]));
  render(<HueCurvesSection store={store} clipIds={["c1"]} />);
  act(() => { fireEvent.click(screen.getByTestId("adjust-section-Hue Curves")); });
  act(() => { fireEvent.click(screen.getByTestId("hue-curve-add-point")); });

  const before = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
  expect(before.effects?.some((e) => e.type === "color.hueCurves")).toBe(true);

  act(() => { fireEvent.click(screen.getByTestId("adjust-section-reset-Hue Curves")); });
  const after = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
  expect(after.effects?.some((e) => e.type === "color.hueCurves") ?? false).toBe(false);
});

test("HueCurvesSection is collapsed by default", () => {
  const store = new EditorStore(makeTimeline([makeClip("c1")]));
  render(<HueCurvesSection store={store} clipIds={["c1"]} />);
  expect(screen.queryByTestId("hue-curve-channel-hueVsHue")).not.toBeInTheDocument();
});
