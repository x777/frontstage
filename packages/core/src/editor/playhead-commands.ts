import type { Timeline } from "../timeline.js";
import { findClip } from "../timeline.js";
import { clipEndFrame } from "../clip.js";
import type { MediaManifestEntry } from "../media.js";
import { secondsToFrame } from "../time.js";
import type { Command } from "./editor-store.js";
import { splitLinkedClipCommand, trimClipCommand, addClipCommand } from "./timeline-commands.js";
import { setClipPropertyCommand } from "./commands.js";

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

// EditorViewModel+MediaLibrary.swift:685-724 — new topmost track, 3s default duration, selects the
// new clip. Deviation from Swift: Swift computes a natural-size centered text transform; the TS
// text paths (add_texts, placeCaptionsCommand) both use the default full-box transform and the
// engine centers text within it, so the rendered result is identical — only the transform-overlay
// box differs. This follows the existing TS convention rather than inventing a text measure.
export function addTextClipAtPlayhead(
  frame: number,
  fps: number,
  newId: () => string = () => crypto.randomUUID(),
): { command: Command; clipId: string } {
  const clipId = newId();
  const startFrame = Math.max(0, frame);
  const durationFrames = Math.max(1, secondsToFrame(3.0, fps));
  const entry: MediaManifestEntry = {
    id: newId(),
    name: "Text",
    type: "text",
    source: { kind: "project", relativePath: "" },
    duration: durationFrames / fps,
  };
  const command: Command = {
    label: "Add Text",
    apply(timeline: Timeline): Timeline {
      // addClipCommand's newId is called once per entity it mints. For a text entry on a
      // {kind:"new"} target that's TWO calls — the visual clip id, then the new track id
      // (text never links audio, so no third call). Only the first call may return clipId;
      // later calls must mint fresh ids or the track would collide with the clip id.
      let clipIdConsumed = false;
      const perEntityNewId = (): string => {
        if (!clipIdConsumed) {
          clipIdConsumed = true;
          return clipId;
        }
        return newId();
      };
      let t = addClipCommand(entry, { kind: "new", index: 0 }, startFrame, fps, undefined, perEntityNewId).apply(timeline);
      t = setClipPropertyCommand(clipId, "textContent", "Text").apply(t);
      return t;
    },
  };
  return { command, clipId };
}
