import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { LUTSection } from "../src/inspector/adjust/index.js";
import { EditorStore, defaultTimeline, defaultTransform, defaultCrop } from "@palmier/core";
import type { Clip, Track } from "@palmier/core";
import type { CubeLUT } from "@palmier/core";

function makeClip(id: string, overrides?: Partial<Clip>): Clip {
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
    ...overrides,
  };
}

function makeTimeline(clips: Clip[]) {
  const track: Track = { id: "t1", type: "video", muted: false, hidden: false, syncLocked: false, clips };
  return { ...defaultTimeline(), tracks: [track] };
}

// Minimal valid dim-2 identity cube (2^3 = 8 triplets, r-fastest order)
const CUBE_TEXT = `LUT_3D_SIZE 2
0.0 0.0 0.0
1.0 0.0 0.0
0.0 1.0 0.0
1.0 1.0 0.0
0.0 0.0 1.0
1.0 0.0 1.0
0.0 1.0 1.0
1.0 1.0 1.0
`;

// Simulate a file pick on the hidden input. Sets files via defineProperty since
// jsdom FileList is read-only, then fires the change event.
function pickFile(input: HTMLElement, file: File) {
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  fireEvent.change(input);
}

test("LUTSection: file pick calls registerLUT and dispatches color.lut path to store", async () => {
  const registerLUT = vi.fn();
  const engineRef = { current: { registerLUT } };
  const store = new EditorStore(makeTimeline([makeClip("c1")]));

  render(<LUTSection store={store} clipIds={["c1"]} engineRef={engineRef} />);

  // Expand the section (collapsed by default)
  act(() => { fireEvent.click(screen.getByTestId("adjust-section-LUTs")); });

  const file = new File([CUBE_TEXT], "test.cube", { type: "text/plain" });
  const input = screen.getByTestId("lut-file-input");
  act(() => { pickFile(input, file); });

  // FileReader is async — wait until registerLUT is called
  await waitFor(() => { expect(registerLUT).toHaveBeenCalledTimes(1); });

  const [calledPath, calledCube] = registerLUT.mock.calls[0] as [string, CubeLUT];
  expect(calledPath).toBe("test.cube");
  expect(calledCube).toMatchObject({ dimension: 2 });
  expect(calledCube.data).toBeInstanceOf(Float32Array);
  expect(calledCube.data.length).toBe(2 ** 3 * 4); // 32 RGBA floats

  const clip = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
  const effect = clip.effects?.find((e) => e.type === "color.lut");
  expect(effect).toBeDefined();
  expect(effect?.params["path"]?.string).toBe("test.cube");
});

test("LUTSection: intensity slider ArrowRight increases intensity when LUT is loaded", () => {
  const store = new EditorStore(makeTimeline([makeClip("c1", {
    effects: [{ id: "e1", type: "color.lut", enabled: true, params: { path: { string: "test.cube" }, intensity: { value: 0.5 } } }],
  })]));

  render(<LUTSection store={store} clipIds={["c1"]} />);

  // Expand the section
  act(() => { fireEvent.click(screen.getByTestId("adjust-section-LUTs")); });

  const slider = screen.getByRole("slider");
  act(() => { fireEvent.keyDown(slider, { key: "ArrowRight" }); });

  const clip = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
  const effect = clip.effects?.find((e) => e.type === "color.lut");
  expect(effect).toBeDefined();
  // intensity was 0.5, ArrowRight adds (1-0)*0.01 = 0.01 → 0.51
  expect(effect?.params["intensity"]?.value).toBeGreaterThan(0.5);
});

test("LUTSection: Remove button fully removes the LUT effect", () => {
  const store = new EditorStore(makeTimeline([makeClip("c1", {
    effects: [{ id: "e1", type: "color.lut", enabled: true, params: { path: { string: "test.cube" } } }],
  })]));

  render(<LUTSection store={store} clipIds={["c1"]} />);

  act(() => { fireEvent.click(screen.getByTestId("adjust-section-LUTs")); });

  act(() => { fireEvent.click(screen.getByTestId("lut-remove")); });

  const clip = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
  expect(clip.effects?.find((e) => e.type === "color.lut")).toBeUndefined();
});

test("LUTSection: Remove fully removes even with a non-default intensity", () => {
  // A customised intensity (0.5) would leave a stale {path:"", intensity:0.5} if Remove
  // used setEffectString(path=""); resetSection removes the effect unconditionally.
  const store = new EditorStore(makeTimeline([makeClip("c1", {
    effects: [{ id: "e1", type: "color.lut", enabled: true, params: { path: { string: "test.cube" }, intensity: { value: 0.5 } } }],
  })]));

  render(<LUTSection store={store} clipIds={["c1"]} />);

  act(() => { fireEvent.click(screen.getByTestId("adjust-section-LUTs")); });
  act(() => { fireEvent.click(screen.getByTestId("lut-remove")); });

  const clip = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
  expect(clip.effects?.find((e) => e.type === "color.lut")).toBeUndefined();
});

test("LUTSection: invalid .cube file shows parse error, registerLUT not called, no dispatch", async () => {
  const registerLUT = vi.fn();
  const engineRef = { current: { registerLUT } };
  const store = new EditorStore(makeTimeline([makeClip("c1")]));

  render(<LUTSection store={store} clipIds={["c1"]} engineRef={engineRef} />);

  act(() => { fireEvent.click(screen.getByTestId("adjust-section-LUTs")); });

  const file = new File(["not a valid cube file"], "bad.cube", { type: "text/plain" });
  const input = screen.getByTestId("lut-file-input");
  act(() => { pickFile(input, file); });

  // Wait for FileReader to complete and parse to fail
  await waitFor(() => { expect(screen.getByTestId("lut-parse-error")).toBeInTheDocument(); });

  expect(registerLUT).not.toHaveBeenCalled();
  const clip = store.getSnapshot().timeline.tracks[0]!.clips[0]!;
  expect(clip.effects?.find((e) => e.type === "color.lut")).toBeUndefined();
});
