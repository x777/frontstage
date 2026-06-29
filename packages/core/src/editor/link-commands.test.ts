import { describe, it, expect } from "vitest";
import type { Clip } from "../clip.js";
import type { Timeline, Track } from "../timeline.js";
import { linkClipsCommand, unlinkClipsCommand } from "./link-commands.js";

function clip(id: string, over: Partial<Clip> = {}): Clip {
  return {
    id, mediaRef: "m", mediaType: "video", sourceClipType: "video",
    startFrame: 0, durationFrames: 30, trimStartFrame: 0, trimEndFrame: 0,
    speed: 1, volume: 1, fadeInFrames: 0, fadeOutFrames: 0,
    fadeInInterpolation: "linear", fadeOutInterpolation: "linear", opacity: 1,
    transform: { centerX: 0.5, centerY: 0.5, width: 1, height: 1, rotation: 0, flipHorizontal: false, flipVertical: false },
    crop: { top: 0, bottom: 0, left: 0, right: 0 },
    ...over,
  };
}
function track(id: string, clips: Clip[]): Track {
  return { id, type: "video", muted: false, hidden: false, syncLocked: false, clips };
}
function timeline(tracks: Track[]): Timeline {
  return { fps: 30, width: 1920, height: 1080, settingsConfigured: true, tracks };
}
function groupOf(tl: Timeline, id: string): string | undefined {
  for (const t of tl.tracks) for (const c of t.clips) if (c.id === id) return c.linkGroupId;
  return undefined;
}

describe("linkClipsCommand", () => {
  it("stamps one shared linkGroupId on all ids", () => {
    const tl = timeline([track("vt", [clip("v")]), track("at", [clip("a", { mediaType: "audio" })])]);
    const next = linkClipsCommand(["v", "a"], () => "G").apply(tl);
    expect(groupOf(next, "v")).toBe("G");
    expect(groupOf(next, "a")).toBe("G");
    expect(next).not.toBe(tl); // immutable
  });
  it("is a no-op for fewer than 2 ids", () => {
    const tl = timeline([track("vt", [clip("v")])]);
    expect(linkClipsCommand(["v"], () => "G").apply(tl)).toBe(tl);
  });
});

describe("unlinkClipsCommand", () => {
  it("clears linkGroupId across the whole expanded group", () => {
    const tl = timeline([
      track("vt", [clip("v", { linkGroupId: "g" })]),
      track("at", [clip("a", { linkGroupId: "g", mediaType: "audio" })]),
    ]);
    // unlink targeting only "v" still clears its partner "a"
    const next = unlinkClipsCommand(["v"]).apply(tl);
    expect(groupOf(next, "v")).toBeUndefined();
    expect(groupOf(next, "a")).toBeUndefined();
  });
  it("leaves unlinked clips untouched and is immutable", () => {
    const tl = timeline([track("vt", [clip("x")])]);
    const next = unlinkClipsCommand(["x"]).apply(tl);
    expect(groupOf(next, "x")).toBeUndefined();
  });
});
