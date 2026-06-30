import { describe, it, expect } from "vitest";
import type { Clip } from "../clip.js";
import type { Timeline, Track } from "../timeline.js";
import { timelineTrackDisplayLabel } from "./track-commands.js";

function track(id: string, type: Track["type"], clips: Clip[] = [], over: Partial<Track> = {}): Track {
  return { id, type, muted: false, hidden: false, syncLocked: false, clips, ...over };
}
function timeline(tracks: Track[]): Timeline {
  return { fps: 30, width: 1920, height: 1080, settingsConfigured: true, tracks };
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
