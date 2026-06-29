import type { Clip } from "../clip.js";
import type { Timeline } from "../timeline.js";
import type { Command } from "./editor-store.js";
import { expandToLinkGroup } from "../timeline/link-group.js";

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
