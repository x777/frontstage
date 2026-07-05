import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Clip, Timeline, Track } from "@frontstage/core";
import type { MediaByteSource } from "../src/media/media-source.js";
import { SourceCoordinator } from "../src/compositor/source-coordinator.js";

// The image decode path goes through createImageBitmap/VideoFrame, which don't exist in
// node. Mock ImageSource so create()/reconcile() control flow (the thing under test) runs
// without needing real browser decode APIs.
vi.mock("../src/media/image-source.js", () => {
  class FakeImageSource {
    static async create(_bytes: ArrayBuffer): Promise<FakeImageSource> {
      return new FakeImageSource();
    }
    frame(): unknown { return { close: () => {} }; }
    size(): { width: number; height: number } { return { width: 4, height: 4 }; }
    dispose(): void {}
  }
  return { ImageSource: FakeImageSource };
});

function clip(id: string, mediaRef: string): Clip {
  return {
    id, mediaRef, mediaType: "image", sourceClipType: "image",
    startFrame: 0, durationFrames: 30, trimStartFrame: 0, trimEndFrame: 0,
    speed: 1, volume: 1, fadeInFrames: 0, fadeOutFrames: 0,
    fadeInInterpolation: "linear", fadeOutInterpolation: "linear", opacity: 1,
    transform: { centerX: 0.5, centerY: 0.5, width: 1, height: 1, rotation: 0, flipHorizontal: false, flipVertical: false },
    crop: { top: 0, bottom: 0, left: 0, right: 0 },
  };
}
function track(id: string, clips: Clip[]): Track {
  return { id, type: "video", muted: false, hidden: false, syncLocked: false, clips };
}
function timeline(tracks: Track[]): Timeline {
  return { fps: 30, width: 4, height: 4, settingsConfigured: true, tracks };
}

function makeMedia(openableRefs: Set<string>): MediaByteSource {
  return {
    open: vi.fn(async (ref: string) => {
      if (!openableRefs.has(ref)) throw new Error(`missing media: ${ref}`);
      return new Blob([new Uint8Array([1, 2, 3, 4])]);
    }),
  };
}

describe("SourceCoordinator missing-media tolerance", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("create() skips a clip whose media.open rejects and keeps the rest", async () => {
    const tl = timeline([track("t", [clip("c-ok", "ok"), clip("c-missing", "missing")])]);
    const media = makeMedia(new Set(["ok"]));

    const coordinator = await SourceCoordinator.create(tl, media);

    expect(coordinator.sourceSizes().has("ok")).toBe(true);
    expect(coordinator.sourceSizes().has("missing")).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("reconcile() retries a previously-failed clip once its media becomes openable", async () => {
    const tl = timeline([track("t", [clip("c-ok", "ok"), clip("c-missing", "missing")])]);
    const openable = new Set(["ok"]);
    const media = makeMedia(openable);

    const coordinator = await SourceCoordinator.create(tl, media);
    expect(coordinator.sourceSizes().has("missing")).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    // reconcile with the same still-missing ref must not warn again (warn-once)
    await coordinator.reconcile(tl);
    expect(coordinator.sourceSizes().has("missing")).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    // media becomes available (e.g. generation placeholder finalized) — next reconcile opens it
    openable.add("missing");
    await coordinator.reconcile(tl);
    expect(coordinator.sourceSizes().has("missing")).toBe(true);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("does not change behavior for clips whose media opens fine", async () => {
    const tl = timeline([track("t", [clip("c1", "a"), clip("c2", "b")])]);
    const media = makeMedia(new Set(["a", "b"]));

    const coordinator = await SourceCoordinator.create(tl, media);

    expect(coordinator.sourceSizes().has("a")).toBe(true);
    expect(coordinator.sourceSizes().has("b")).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
