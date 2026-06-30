import type { Timeline } from "../timeline.js";
import type { ClipType } from "../clip-type.js";
import { computeZones } from "../timeline/zones.js";
import type { Command } from "./editor-store.js";
import { TRACK_MIN_HEIGHT, TRACK_MAX_HEIGHT } from "../timeline/geometry.js";

const TRACK_LABEL_PREFIX: Record<ClipType, string> = { video: "V", audio: "A", image: "I", text: "T", lottie: "L" };

// V1/A1-style label. Audio counts top-down; visual counts this track down to the V/A divider (so V1 sits just above audio).
export function timelineTrackDisplayLabel(timeline: Timeline, trackIndex: number): string {
  const tracks = timeline.tracks;
  if (trackIndex < 0 || trackIndex >= tracks.length) return "";
  const type = tracks[trackIndex]!.type;
  const z = computeZones(timeline);
  let n = 0;
  if (type === "audio") {
    for (let i = 0; i <= trackIndex; i++) if (tracks[i]!.type === type) n++;
  } else {
    const end = Math.max(trackIndex + 1, z.firstAudioIndex);
    for (let i = trackIndex; i < end; i++) if (tracks[i]!.type === type) n++;
  }
  return `${TRACK_LABEL_PREFIX[type]}${n}`;
}

function toggleTrackFlagCommand(trackId: string, flag: "muted" | "hidden" | "syncLocked", label: string): Command {
  return {
    label,
    apply(timeline: Timeline): Timeline {
      let changed = false;
      const tracks = timeline.tracks.map((t) => {
        if (t.id !== trackId) return t;
        changed = true;
        return { ...t, [flag]: !t[flag] };
      });
      return changed ? { ...timeline, tracks } : timeline;
    },
  };
}

export function toggleTrackMuteCommand(trackId: string): Command {
  return toggleTrackFlagCommand(trackId, "muted", "Mute Track");
}
export function toggleTrackHiddenCommand(trackId: string): Command {
  return toggleTrackFlagCommand(trackId, "hidden", "Hide Track");
}
export function toggleTrackSyncLockCommand(trackId: string): Command {
  return toggleTrackFlagCommand(trackId, "syncLocked", "Sync Lock Track");
}

export function setTrackHeightCommand(trackId: string, height: number): Command {
  return {
    label: "Resize Track",
    apply(timeline: Timeline): Timeline {
      const clamped = Math.max(TRACK_MIN_HEIGHT, Math.min(TRACK_MAX_HEIGHT, height));
      let changed = false;
      const tracks = timeline.tracks.map((t) => {
        if (t.id !== trackId) return t;
        changed = true;
        return { ...t, displayHeight: clamped };
      });
      return changed ? { ...timeline, tracks } : timeline;
    },
  };
}
