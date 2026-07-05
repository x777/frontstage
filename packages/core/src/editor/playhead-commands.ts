import type { Timeline } from "../timeline.js";
import { findClip } from "../timeline.js";
import { clipEndFrame } from "../clip.js";
import type { Command } from "./editor-store.js";
import { splitLinkedClipCommand, trimClipCommand } from "./timeline-commands.js";

// EditorViewModel+ClipMutations.swift:645-680 — selection loops over the existing primitives.
// One Command per action: apply() folds per-clip work; dispatch() = one undo entry, and an
// all-skip apply returns the input timeline so no undo entry is created (Swift no-op parity).

export function splitAtPlayheadCommand(
  selectedIds: readonly string[],
  frame: number,
  newId: () => string = () => crypto.randomUUID(),
): Command {
  return {
    label: "Split at Playhead",
    apply(timeline: Timeline): Timeline {
      let t = timeline;
      for (const id of selectedIds) {
        const loc = findClip(t, id);
        if (!loc) continue;
        const clip = t.tracks[loc.trackIndex]!.clips[loc.clipIndex]!;
        if (frame <= clip.startFrame || frame >= clipEndFrame(clip)) continue;
        t = splitLinkedClipCommand(id, frame, undefined, newId).apply(t);
      }
      return t;
    },
  };
}

export function trimStartToPlayheadCommand(selectedIds: readonly string[], frame: number): Command {
  return {
    label: "Trim Start to Playhead",
    apply(timeline: Timeline): Timeline {
      let t = timeline;
      for (const id of selectedIds) {
        const loc = findClip(t, id);
        if (!loc) continue;
        const clip = t.tracks[loc.trackIndex]!.clips[loc.clipIndex]!;
        if (!(clip.startFrame < frame && frame < clipEndFrame(clip))) continue;
        t = trimClipCommand(id, "left", frame - clip.startFrame).apply(t);
      }
      return t;
    },
  };
}

export function trimEndToPlayheadCommand(selectedIds: readonly string[], frame: number): Command {
  return {
    label: "Trim End to Playhead",
    apply(timeline: Timeline): Timeline {
      let t = timeline;
      for (const id of selectedIds) {
        const loc = findClip(t, id);
        if (!loc) continue;
        const clip = t.tracks[loc.trackIndex]!.clips[loc.clipIndex]!;
        if (!(clip.startFrame < frame && frame < clipEndFrame(clip))) continue;
        t = trimClipCommand(id, "right", frame - clipEndFrame(clip)).apply(t);
      }
      return t;
    },
  };
}
