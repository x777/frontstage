import { describe, it, expect } from "vitest";
import type { Clip } from "../clip.js";
import type { Timeline, Track } from "../timeline.js";
import { linkIndex, expandToLinkGroup, linkedPartnerIds, timingPropagationPartners, partnerMoves, linkGroupOffsets, canLinkClips, canUnlinkClips } from "./link-group.js";

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

// v + a share group "g"; x is unlinked.
function tl(): Timeline {
  return timeline([
    track("vt", [clip("v", { linkGroupId: "g" }), clip("x")]),
    track("at", [clip("a", { linkGroupId: "g", mediaType: "audio" })]),
  ]);
}

describe("linkIndex", () => {
  it("maps each groupId to its member clip ids", () => {
    expect(linkIndex(tl())).toEqual(new Map([["g", ["v", "a"]]]));
  });
  it("is empty when no clip is linked", () => {
    expect(linkIndex(timeline([track("t", [clip("x")])]))).toEqual(new Map());
  });
});

describe("expandToLinkGroup", () => {
  it("pulls in a clip's group partners", () => {
    expect(expandToLinkGroup(tl(), new Set(["v"]))).toEqual(new Set(["v", "a"]));
  });
  it("returns the input unchanged for an unlinked id", () => {
    expect(expandToLinkGroup(tl(), new Set(["x"]))).toEqual(new Set(["x"]));
  });
  it("keeps unlinked ids alongside expanded groups", () => {
    expect(expandToLinkGroup(tl(), new Set(["a", "x"]))).toEqual(new Set(["v", "a", "x"]));
  });
});

describe("linkedPartnerIds", () => {
  it("returns group members excluding the clip itself", () => {
    expect(linkedPartnerIds(tl(), "v")).toEqual(["a"]);
  });
  it("returns [] for an unlinked clip", () => {
    expect(linkedPartnerIds(tl(), "x")).toEqual([]);
  });
});

describe("timingPropagationPartners", () => {
  it("returns partners not already in the input set", () => {
    expect(timingPropagationPartners(tl(), new Set(["v"]))).toEqual(new Set(["a"]));
  });
  it("excludes partners already selected", () => {
    expect(timingPropagationPartners(tl(), new Set(["v", "a"]))).toEqual(new Set());
  });
});

describe("partnerMoves", () => {
  it("shifts partners by the lead's delta, clamped to >= 0", () => {
    // v at 0, move to 100 (delta +100) -> partner a (at 0) -> 100
    expect(partnerMoves(tl(), "v", 100)).toEqual([{ clipId: "a", newStartFrame: 100 }]);
  });
  it("clamps a negative partner result to 0", () => {
    const t = timeline([
      track("vt", [clip("v", { linkGroupId: "g", startFrame: 50 })]),
      track("at", [clip("a", { linkGroupId: "g", mediaType: "audio", startFrame: 10 })]),
    ]);
    // move v 50 -> 0 (delta -50); a 10 + (-50) = -40 -> clamp 0
    expect(partnerMoves(t, "v", 0)).toEqual([{ clipId: "a", newStartFrame: 0 }]);
  });
  it("returns [] for a zero delta or an unlinked clip", () => {
    expect(partnerMoves(tl(), "v", 0)).toEqual([]);
    expect(partnerMoves(tl(), "x", 100)).toEqual([]);
  });
});

describe("linkGroupOffsets", () => {
  it("reports the offset of each out-of-sync clip vs the group minimum", () => {
    const t = timeline([
      track("vt", [clip("v", { linkGroupId: "g", startFrame: 0, trimStartFrame: 0 })]),     // start-trim = 0
      track("at", [clip("a", { linkGroupId: "g", mediaType: "audio", startFrame: 7, trimStartFrame: 0 })]), // = 7
    ]);
    expect(linkGroupOffsets(t)).toEqual(new Map([["a", 7]]));
  });
  it("omits in-sync and unlinked clips", () => {
    expect(linkGroupOffsets(tl())).toEqual(new Map()); // v and a both start-trim = 0
  });
});

describe("canLinkClips", () => {
  it("is true for >=2 clips of different media types not already one group", () => {
    const t = timeline([track("vt", [clip("v"), clip("a", { mediaType: "audio" })])]);
    expect(canLinkClips(t, new Set(["v", "a"]))).toBe(true);
  });
  it("is false for fewer than 2 clips", () => {
    expect(canLinkClips(tl(), new Set(["v"]))).toBe(false);
  });
  it("is false when all selected clips are the same media type", () => {
    const t = timeline([track("vt", [clip("v1"), clip("v2")])]);
    expect(canLinkClips(t, new Set(["v1", "v2"]))).toBe(false);
  });
  it("is false when the selection is already exactly one group", () => {
    expect(canLinkClips(tl(), new Set(["v", "a"]))).toBe(false);
  });
});

describe("canUnlinkClips", () => {
  it("is true when any selected clip is linked", () => {
    expect(canUnlinkClips(tl(), new Set(["v"]))).toBe(true);
  });
  it("is false when no selected clip is linked", () => {
    expect(canUnlinkClips(tl(), new Set(["x"]))).toBe(false);
  });
});
