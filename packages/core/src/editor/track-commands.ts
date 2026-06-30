import type { Timeline } from "../timeline.js";
import type { ClipType } from "../clip-type.js";
import { computeZones } from "../timeline/zones.js";

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
