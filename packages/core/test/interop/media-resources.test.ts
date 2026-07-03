import { describe, it, expect } from "vitest";
import { collectMediaResources } from "../../src/interop/media-resources.js";
import type { Clip } from "../../src/clip.js";
import type { Track, Timeline } from "../../src/timeline.js";
import type { MediaManifestEntry } from "../../src/media.js";

function makeClip(overrides: Partial<Clip> & { id: string; mediaRef: string }): Clip {
  return {
    mediaType: "video",
    sourceClipType: "video",
    startFrame: 0,
    durationFrames: 60,
    trimStartFrame: 0,
    trimEndFrame: 0,
    speed: 1,
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    fadeInInterpolation: "linear",
    fadeOutInterpolation: "linear",
    opacity: 1,
    transform: { centerX: 0.5, centerY: 0.5, width: 1, height: 1, rotation: 0, flipHorizontal: false, flipVertical: false },
    crop: { left: 0, top: 0, right: 0, bottom: 0 },
    ...overrides,
  };
}

function makeTrack(clips: Clip[], id = "t1", type: Track["type"] = "video"): Track {
  return { id, type, muted: false, hidden: false, syncLocked: false, clips };
}

function makeTimeline(tracks: Track[]): Timeline {
  return { fps: 30, width: 1920, height: 1080, settingsConfigured: true, tracks };
}

function externalEntry(id: string, absolutePath: string, overrides: Partial<MediaManifestEntry> = {}): MediaManifestEntry {
  return { id, name: id, type: "video", source: { kind: "external", absolutePath }, duration: 5, ...overrides };
}

function projectEntry(id: string, relativePath: string, overrides: Partial<MediaManifestEntry> = {}): MediaManifestEntry {
  return { id, name: id, type: "video", source: { kind: "project", relativePath }, duration: 5, ...overrides };
}

describe("collectMediaResources", () => {
  it("dedupes two clips referencing the same media into one resource", () => {
    const entries = [externalEntry("media-1", "/Users/x/Movies/clip.mp4")];
    const timeline = makeTimeline([
      makeTrack([
        makeClip({ id: "c1", mediaRef: "media-1", startFrame: 0 }),
        makeClip({ id: "c2", mediaRef: "media-1", startFrame: 60 }),
      ]),
    ]);

    const { byRef, ordered } = collectMediaResources(timeline, entries, undefined, "MyProject");
    expect(ordered).toHaveLength(1);
    expect(byRef.size).toBe(1);
    expect(byRef.get("media-1")).toBe(ordered[0]);
  });

  it("assigns ids r1, r2, … in order of first appearance", () => {
    const entries = [externalEntry("media-a", "/a.mp4"), externalEntry("media-b", "/b.mp4")];
    const timeline = makeTimeline([
      makeTrack([makeClip({ id: "c1", mediaRef: "media-b", startFrame: 0 }), makeClip({ id: "c2", mediaRef: "media-a", startFrame: 60 })]),
    ]);

    const { ordered } = collectMediaResources(timeline, entries, undefined, "MyProject");
    expect(ordered.map((r) => r.id)).toEqual(["r1", "r2"]);
    expect(ordered.map((r) => r.entry.id)).toEqual(["media-b", "media-a"]);
  });

  it("skips clips whose mediaRef has no manifest entry", () => {
    const timeline = makeTimeline([makeTrack([makeClip({ id: "ghost", mediaRef: "missing", startFrame: 0 })])]);
    const { ordered, byRef } = collectMediaResources(timeline, [], undefined, "MyProject");
    expect(ordered).toHaveLength(0);
    expect(byRef.size).toBe(0);
  });

  it("fileName is the last path component WITH extension, for both external and project sources", () => {
    const entries = [externalEntry("media-1", "/Users/x/Movies/My Clip.mp4"), projectEntry("media-2", "media/other.mov")];
    const timeline = makeTimeline([
      makeTrack([makeClip({ id: "c1", mediaRef: "media-1", startFrame: 0 }), makeClip({ id: "c2", mediaRef: "media-2", startFrame: 60 })]),
    ]);

    const { byRef } = collectMediaResources(timeline, entries, "/Users/x/Projects/Proj", "Proj");
    expect(byRef.get("media-1")!.fileName).toBe("My Clip.mp4");
    expect(byRef.get("media-2")!.fileName).toBe("other.mov");
  });

  it("external source → file:// URL from the absolute POSIX path", () => {
    const entries = [externalEntry("media-1", "/Users/x/Movies/clip.mp4")];
    const timeline = makeTimeline([makeTrack([makeClip({ id: "c1", mediaRef: "media-1", startFrame: 0 })])]);
    const { byRef } = collectMediaResources(timeline, entries, undefined, "MyProject");
    expect(byRef.get("media-1")!.fileUrl).toBe("file:///Users/x/Movies/clip.mp4");
  });

  it("external Windows path → forward-slash file:// URL with the drive letter preserved", () => {
    const entries = [externalEntry("media-1", "C:\\Users\\x\\Movies\\clip.mp4")];
    const timeline = makeTimeline([makeTrack([makeClip({ id: "c1", mediaRef: "media-1", startFrame: 0 })])]);
    const { byRef } = collectMediaResources(timeline, entries, undefined, "MyProject");
    expect(byRef.get("media-1")!.fileUrl).toBe("file:///C:/Users/x/Movies/clip.mp4");
  });

  it("percent-encodes special characters (e.g. spaces) in path segments", () => {
    const entries = [externalEntry("media-1", "/Users/x/My Movies/a clip.mp4")];
    const timeline = makeTimeline([makeTrack([makeClip({ id: "c1", mediaRef: "media-1", startFrame: 0 })])]);
    const { byRef } = collectMediaResources(timeline, entries, undefined, "MyProject");
    expect(byRef.get("media-1")!.fileUrl).toBe("file:///Users/x/My%20Movies/a%20clip.mp4");
  });

  it("project source with a projectRoot joins root + relativePath", () => {
    const entries = [projectEntry("media-1", "media/clip.mp4")];
    const timeline = makeTimeline([makeTrack([makeClip({ id: "c1", mediaRef: "media-1", startFrame: 0 })])]);
    const { byRef } = collectMediaResources(timeline, entries, "/Users/x/Projects/Proj", "Proj");
    expect(byRef.get("media-1")!.fileUrl).toBe("file:///Users/x/Projects/Proj/media/clip.mp4");
  });

  it("project source without a projectRoot (web) falls back to file:///<projectName>/<rel>", () => {
    const entries = [projectEntry("media-1", "media/clip.mp4")];
    const timeline = makeTimeline([makeTrack([makeClip({ id: "c1", mediaRef: "media-1", startFrame: 0 })])]);
    const { byRef } = collectMediaResources(timeline, entries, undefined, "MyProject");
    expect(byRef.get("media-1")!.fileUrl).toBe("file:///MyProject/media/clip.mp4");
  });
});
