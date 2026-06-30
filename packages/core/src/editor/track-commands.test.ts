import { describe, it, expect } from "vitest";
import type { Clip } from "../clip.js";
import type { Timeline, Track } from "../timeline.js";
import { timelineTrackDisplayLabel, toggleTrackMuteCommand, toggleTrackHiddenCommand, toggleTrackSyncLockCommand, setTrackHeightCommand } from "./track-commands.js";

function track(id: string, type: Track["type"], clips: Clip[] = [], over: Partial<Track> = {}): Track {
  return { id, type, muted: false, hidden: false, syncLocked: false, clips, displayHeight: 120, ...over };
}
function timeline(tracks: Track[]): Timeline {
  return { fps: 30, width: 1920, height: 1080, settingsConfigured: true, tracks };
}

function trackById(tl: Timeline, id: string): Track {
  return tl.tracks.find((t) => t.id === id)!;
}

describe("timelineTrackDisplayLabel", () => {
  // [V?, V?, A?] — firstAudioIndex = 2
  const tl = timeline([track("v0", "video"), track("v1", "video"), track("a0", "audio")]);
  it("numbers video tracks bottom-up (the one above audio is V1)", () => {
    expect(timelineTrackDisplayLabel(tl, 0)).toBe("V2"); // top video
    expect(timelineTrackDisplayLabel(tl, 1)).toBe("V1"); // just above the divider
  });
  it("numbers audio tracks top-down (A1 first)", () => {
    const t = timeline([track("v0", "video"), track("a0", "audio"), track("a1", "audio")]);
    expect(timelineTrackDisplayLabel(t, 1)).toBe("A1");
    expect(timelineTrackDisplayLabel(t, 2)).toBe("A2");
  });
  it("uses the type prefix and returns '' out of range", () => {
    expect(timelineTrackDisplayLabel(timeline([track("i0", "image")]), 0)).toBe("I1");
    expect(timelineTrackDisplayLabel(tl, 9)).toBe("");
  });
});

describe("track flag toggles", () => {
  it("toggleTrackMuteCommand flips muted and is its own inverse", () => {
    const tl = timeline([track("a", "audio")]);
    const once = toggleTrackMuteCommand("a").apply(tl);
    expect(trackById(once, "a").muted).toBe(true);
    expect(once).not.toBe(tl); // immutable
    const twice = toggleTrackMuteCommand("a").apply(once);
    expect(trackById(twice, "a").muted).toBe(false);
  });
  it("toggleTrackHiddenCommand and toggleTrackSyncLockCommand flip their flags", () => {
    const tl = timeline([track("v", "video")]);
    expect(trackById(toggleTrackHiddenCommand("v").apply(tl), "v").hidden).toBe(true);
    expect(trackById(toggleTrackSyncLockCommand("v").apply(tl), "v").syncLocked).toBe(true); // flips false -> true
  });
  it("is a no-op (same ref) for an unknown track id", () => {
    const tl = timeline([track("v", "video")]);
    expect(toggleTrackMuteCommand("missing").apply(tl)).toBe(tl);
  });
});

describe("setTrackHeightCommand", () => {
  it("sets displayHeight clamped to the min/max bounds", () => {
    const tl = timeline([track("v", "video")]);
    expect(trackById(setTrackHeightCommand("v", 80).apply(tl), "v").displayHeight).toBe(80);
    expect(trackById(setTrackHeightCommand("v", 5).apply(tl), "v").displayHeight).toBe(36);   // TRACK_MIN_HEIGHT
    expect(trackById(setTrackHeightCommand("v", 9999).apply(tl), "v").displayHeight).toBe(240); // TRACK_MAX_HEIGHT
  });
});
