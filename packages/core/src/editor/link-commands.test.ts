import { describe, it, expect } from "vitest";
import type { Clip } from "../clip.js";
import type { Timeline, Track } from "../timeline.js";
import { linkClipsCommand, unlinkClipsCommand, canLinkSelection, canUnlinkSelection } from "./link-commands.js";

function clip(id: string, startFrame?: number | Partial<Clip>, durationFrames?: number | Partial<Clip>, over?: Partial<Clip>): Clip {
  let s = 0;
  let d = 30;
  let overrides: Partial<Clip> = {};
  if (typeof startFrame === "object") {
    overrides = startFrame;
  } else if (typeof startFrame === "number") {
    s = startFrame;
    if (typeof durationFrames === "number") {
      d = durationFrames;
      overrides = over || {};
    } else if (typeof durationFrames === "object") {
      overrides = durationFrames;
    }
  }
  return {
    id, mediaRef: "m", mediaType: "video", sourceClipType: "video",
    startFrame: s, durationFrames: d, trimStartFrame: 0, trimEndFrame: 0,
    speed: 1, volume: 1, fadeInFrames: 0, fadeOutFrames: 0,
    fadeInInterpolation: "linear", fadeOutInterpolation: "linear", opacity: 1,
    transform: { centerX: 0.5, centerY: 0.5, width: 1, height: 1, rotation: 0, flipHorizontal: false, flipVertical: false },
    crop: { top: 0, bottom: 0, left: 0, right: 0 },
    ...overrides,
  };
}
function track(id: string, clips: Clip[], type: Track["type"] = "video"): Track {
  return { id, type, muted: false, hidden: false, syncLocked: false, clips };
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

describe("canLinkSelection / canUnlinkSelection", () => {
  it("canLink requires >= 2 clips spanning >= 2 types, not already one group", () => {
    const tl = timeline([
      track("v", [clip("a", 0, 10, { mediaType: "video" })]),
      track("au", [clip("b", 0, 10, { mediaType: "audio" })], "audio"),
    ]);
    expect(canLinkSelection(tl, new Set(["a", "b"]))).toBe(true);
    expect(canLinkSelection(tl, new Set(["a"]))).toBe(false); // only one clip
    const same = timeline([track("v", [clip("a", 0, 10, { mediaType: "video" }), clip("c", 20, 10, { mediaType: "video" })])]);
    expect(canLinkSelection(same, new Set(["a", "c"]))).toBe(false); // single type
    const linked = timeline([
      track("v", [clip("a", 0, 10, { mediaType: "video", linkGroupId: "g" })]),
      track("au", [clip("b", 0, 10, { mediaType: "audio", linkGroupId: "g" })], "audio"),
    ]);
    expect(canLinkSelection(linked, new Set(["a", "b"]))).toBe(false); // already one group
  });
  it("canUnlink requires any selected clip to be in a link group", () => {
    const tl = timeline([
      track("v", [clip("a", 0, 10, { linkGroupId: "g" })]),
      track("au", [clip("b", 0, 10)], "audio"),
    ]);
    expect(canUnlinkSelection(tl, new Set(["a"]))).toBe(true);
    expect(canUnlinkSelection(tl, new Set(["b"]))).toBe(false);
  });
});
