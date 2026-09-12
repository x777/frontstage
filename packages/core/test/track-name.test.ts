import { describe, expect, test } from "vitest";
import { TRACK_NAME_MAX_LENGTH, normalizeTrackName } from "../src/track-name.js";
import {
  applyManageTracks,
  defaultTimeline,
  setTrackNameCommand,
  type Timeline,
  type Track,
} from "../src/index.js";
import { EditorStore } from "../src/editor/editor-store.js";

function track(id: string, type: Track["type"], extra: Partial<Track> = {}): Track {
  return { id, type, muted: false, hidden: false, syncLocked: false, clips: [], ...extra };
}

function tl(tracks: Track[]): Timeline {
  return { ...defaultTimeline(), tracks };
}

describe("normalizeTrackName", () => {
  test("trims whitespace and keeps a short name", () => {
    expect(normalizeTrackName("  Main  ")).toEqual({ ok: true, name: "Main" });
  });

  test("empty or whitespace-only clears the name", () => {
    expect(normalizeTrackName("")).toEqual({ ok: true, name: undefined });
    expect(normalizeTrackName("   ")).toEqual({ ok: true, name: undefined });
    expect(normalizeTrackName(undefined)).toEqual({ ok: true, name: undefined });
  });

  test("rejects control characters, newlines, and names over 80", () => {
    expect(normalizeTrackName("Main\nVideo").ok).toBe(false);
    expect(normalizeTrackName("Main\tVideo").ok).toBe(false);
    expect(normalizeTrackName("x".repeat(TRACK_NAME_MAX_LENGTH + 1)).ok).toBe(false);
    expect(normalizeTrackName("x".repeat(TRACK_NAME_MAX_LENGTH))).toEqual({
      ok: true,
      name: "x".repeat(TRACK_NAME_MAX_LENGTH),
    });
  });
});

describe("setTrackNameCommand", () => {
  test("sets and clears a user-authored name in one undo each", () => {
    const store = new EditorStore(tl([track("v", "video")]));
    store.dispatch(setTrackNameCommand("v", "Dialogue"));
    expect(store.getSnapshot().timeline.tracks[0]!.name).toBe("Dialogue");
    store.dispatch(setTrackNameCommand("v", "  "));
    expect(store.getSnapshot().timeline.tracks[0]!.name).toBeUndefined();
    store.undo();
    expect(store.getSnapshot().timeline.tracks[0]!.name).toBe("Dialogue");
  });
});

describe("applyManageTracks", () => {
  test("reorders then sets then removes, in that order", () => {
    const before = tl([
      track("v0", "video"),
      track("v1", "video", { name: "B-roll" }),
      track("a0", "audio"),
    ]);
    const after = applyManageTracks(before, {
      reorders: [{ id: "v1", to: 0 }],
      updates: [{ id: "a0", muted: true, includesName: true, name: "Music" }],
      removeIds: ["v0"],
    });
    expect(after.tracks.map((t) => t.id)).toEqual(["v1", "a0"]);
    expect(after.tracks[0]!.name).toBe("B-roll");
    expect(after.tracks[1]!.muted).toBe(true);
    expect(after.tracks[1]!.name).toBe("Music");
  });
});
