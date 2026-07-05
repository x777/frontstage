import { describe, expect, test, vi } from "vitest";
import { defaultTimeline, defaultTransform, defaultCrop } from "@frontstage/core";
import type { Clip, Timeline, Track, CubeLUT } from "@frontstage/core";
import { LutReconciler } from "../src/inspector/adjust/lut-reconciler.js";

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

function makeClip(id: string, over: Partial<Clip> = {}): Clip {
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
    ...over,
  };
}

function lutClip(id: string, path: string): Clip {
  return makeClip(id, {
    effects: [{ id: `${id}-e`, type: "color.lut", enabled: true, params: { path: { string: path }, intensity: { value: 1 } } }],
  });
}

function timelineOf(clips: Clip[]): Timeline {
  const track: Track = { id: "t1", type: "video", muted: false, hidden: false, syncLocked: false, clips };
  return { ...defaultTimeline(), tracks: [track] };
}

describe("LutReconciler", () => {
  test("engine not ready (registerLUT undefined): no-ops, readDerived never called", () => {
    const reconciler = new LutReconciler();
    const readDerived = vi.fn(async () => new TextEncoder().encode(CUBE_TEXT));
    reconciler.reconcile(timelineOf([lutClip("c1", "luts/a.cube")]), readDerived, undefined);
    expect(readDerived).not.toHaveBeenCalled();
  });

  test("a project-relative lut path is loaded, parsed, and registered", async () => {
    const reconciler = new LutReconciler();
    const readDerived = vi.fn(async (p: string) => { expect(p).toBe("luts/a.cube"); return new TextEncoder().encode(CUBE_TEXT); });
    const registerLUT = vi.fn();
    reconciler.reconcile(timelineOf([lutClip("c1", "luts/a.cube")]), readDerived, registerLUT);

    await vi.waitFor(() => expect(registerLUT).toHaveBeenCalledTimes(1));
    const [path, cube] = registerLUT.mock.calls[0] as [string, CubeLUT];
    expect(path).toBe("luts/a.cube");
    expect(cube.dimension).toBe(2);
  });

  test("a bare filename (not project-relative) is skipped — never attempted", async () => {
    const reconciler = new LutReconciler();
    const readDerived = vi.fn(async () => new TextEncoder().encode(CUBE_TEXT));
    const registerLUT = vi.fn();
    reconciler.reconcile(timelineOf([lutClip("c1", "MyLut.cube")]), readDerived, registerLUT);

    await new Promise((r) => setTimeout(r, 0));
    expect(readDerived).not.toHaveBeenCalled();
    expect(registerLUT).not.toHaveBeenCalled();
  });

  test("a path is attempted at most once across repeated reconcile calls", async () => {
    const reconciler = new LutReconciler();
    const readDerived = vi.fn(async () => new TextEncoder().encode(CUBE_TEXT));
    const registerLUT = vi.fn();
    const tl = timelineOf([lutClip("c1", "luts/a.cube")]);

    reconciler.reconcile(tl, readDerived, registerLUT);
    await vi.waitFor(() => expect(registerLUT).toHaveBeenCalledTimes(1));

    reconciler.reconcile(tl, readDerived, registerLUT);
    reconciler.reconcile(tl, readDerived, registerLUT);
    await new Promise((r) => setTimeout(r, 0));

    expect(readDerived).toHaveBeenCalledTimes(1);
    expect(registerLUT).toHaveBeenCalledTimes(1);
  });

  test("multiple clips referencing the SAME lut path -> registered only once", async () => {
    const reconciler = new LutReconciler();
    const readDerived = vi.fn(async () => new TextEncoder().encode(CUBE_TEXT));
    const registerLUT = vi.fn();
    const tl = timelineOf([lutClip("c1", "luts/a.cube"), lutClip("c2", "luts/a.cube")]);

    reconciler.reconcile(tl, readDerived, registerLUT);
    await vi.waitFor(() => expect(registerLUT).toHaveBeenCalledTimes(1));
    expect(readDerived).toHaveBeenCalledTimes(1);
  });

  test("missing bytes (readDerived -> null): registerLUT never called, warns once, isFailed() true, no retry", async () => {
    const reconciler = new LutReconciler();
    const readDerived = vi.fn(async () => null);
    const registerLUT = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tl = timelineOf([lutClip("c1", "luts/gone.cube")]);

    expect(reconciler.isFailed("luts/gone.cube")).toBe(false);
    reconciler.reconcile(tl, readDerived, registerLUT);
    await vi.waitFor(() => expect(readDerived).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(registerLUT).not.toHaveBeenCalled();
    expect(reconciler.isFailed("luts/gone.cube")).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);

    // Repeated reconcile calls (e.g. every store notification) must not retry or warn again.
    reconciler.reconcile(tl, readDerived, registerLUT);
    reconciler.reconcile(tl, readDerived, registerLUT);
    await new Promise((r) => setTimeout(r, 0));
    expect(readDerived).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);

    warn.mockRestore();
  });

  test("invalid .cube content: registerLUT never called, warns once, isFailed() true", async () => {
    const reconciler = new LutReconciler();
    const readDerived = vi.fn(async () => new TextEncoder().encode("not a cube"));
    const registerLUT = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    reconciler.reconcile(timelineOf([lutClip("c1", "luts/bad.cube")]), readDerived, registerLUT);

    await vi.waitFor(() => expect(readDerived).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(registerLUT).not.toHaveBeenCalled();
    expect(reconciler.isFailed("luts/bad.cube")).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  test("subscribe() is notified after a failed load resolves", async () => {
    const reconciler = new LutReconciler();
    const readDerived = vi.fn(async () => null);
    const registerLUT = vi.fn();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const cb = vi.fn();
    reconciler.subscribe(cb);

    reconciler.reconcile(timelineOf([lutClip("c1", "luts/gone.cube")]), readDerived, registerLUT);
    await vi.waitFor(() => expect(cb).toHaveBeenCalledTimes(1));
  });

  test("a successfully loaded path is never marked failed", async () => {
    const reconciler = new LutReconciler();
    const readDerived = vi.fn(async () => new TextEncoder().encode(CUBE_TEXT));
    const registerLUT = vi.fn();
    reconciler.reconcile(timelineOf([lutClip("c1", "luts/a.cube")]), readDerived, registerLUT);

    await vi.waitFor(() => expect(registerLUT).toHaveBeenCalledTimes(1));
    expect(reconciler.isFailed("luts/a.cube")).toBe(false);
  });

  test("a clip with no effects, or a non-lut effect, is ignored", () => {
    const reconciler = new LutReconciler();
    const readDerived = vi.fn(async () => new TextEncoder().encode(CUBE_TEXT));
    const registerLUT = vi.fn();
    const tl = timelineOf([
      makeClip("plain"),
      makeClip("other", { effects: [{ id: "e", type: "color.exposure", enabled: true, params: { ev: { value: 0.2 } } }] }),
    ]);
    reconciler.reconcile(tl, readDerived, registerLUT);
    expect(readDerived).not.toHaveBeenCalled();
  });
});
