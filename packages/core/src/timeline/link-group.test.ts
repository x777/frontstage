import { describe, it, expect } from "vitest";
import type { Clip } from "../clip.js";
import type { Timeline, Track } from "../timeline.js";
import { linkIndex, expandToLinkGroup, linkedPartnerIds, timingPropagationPartners } from "./link-group.js";

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
