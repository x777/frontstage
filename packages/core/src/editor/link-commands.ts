import type { Clip } from "../clip.js";
import type { Timeline } from "../timeline.js";
import type { Command } from "./editor-store.js";
import { expandToLinkGroup } from "../timeline/link-group.js";
import { findClip } from "../timeline.js";

function mapAllClips(timeline: Timeline, fn: (c: Clip) => Clip): Timeline {
  return { ...timeline, tracks: timeline.tracks.map((t) => ({ ...t, clips: t.clips.map(fn) })) };
}

export function linkClipsCommand(ids: string[], newId: () => string = () => crypto.randomUUID()): Command {
  return {
    label: "Link",
    apply(timeline: Timeline): Timeline {
      if (ids.length < 2) return timeline;
      const set = new Set(ids);
      const group = newId();
      return mapAllClips(timeline, (c) => (set.has(c.id) ? { ...c, linkGroupId: group } : c));
    },
  };
}

export function unlinkClipsCommand(ids: string[]): Command {
  return {
    label: "Unlink",
    apply(timeline: Timeline): Timeline {
      const expanded = expandToLinkGroup(timeline, new Set(ids));
      return mapAllClips(timeline, (c) =>
        expanded.has(c.id) && c.linkGroupId != null ? { ...c, linkGroupId: undefined } : c,
      );
    },
  };
}

export function canLinkSelection(timeline: Timeline, ids: ReadonlySet<string>): boolean {
  const clips = [...ids].map((id) => findClip(timeline, id)).filter((l): l is NonNullable<typeof l> => l != null)
    .map((l) => timeline.tracks[l.trackIndex]!.clips[l.clipIndex]!);
  if (clips.length < 2) return false;
  const types = new Set(clips.map((c) => c.mediaType));
  if (types.size < 2) return false;
  const groups = new Set(clips.map((c) => c.linkGroupId));
  return !(groups.size === 1 && !groups.has(undefined)); // not already all one (non-null) group
}

export function canUnlinkSelection(timeline: Timeline, ids: ReadonlySet<string>): boolean {
  for (const id of ids) {
    const loc = findClip(timeline, id);
    if (loc && timeline.tracks[loc.trackIndex]!.clips[loc.clipIndex]!.linkGroupId != null) return true;
  }
  return false;
}
