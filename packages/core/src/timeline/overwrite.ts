import type { Clip } from "../clip.js";
import { clipEndFrame } from "../clip.js";
import { setDuration } from "../clip-mutations.js";

export type OverwriteAction =
  | { kind: "remove"; clipId: string }
  | { kind: "trimEnd"; clipId: string; newDuration: number }
  | { kind: "trimStart"; clipId: string; newStartFrame: number; newTrimStart: number; newDuration: number }
  | {
      kind: "split";
      clipId: string;
      leftDuration: number;
      rightId: string;
      rightStartFrame: number;
      rightTrimStart: number;
      rightDuration: number;
    };

/** Port of OverwriteEngine.computeOverwrite from Swift. */
export function computeOverwrite(
  clips: Clip[],
  regionStart: number,
  regionEnd: number,
): OverwriteAction[] {
  if (regionEnd <= regionStart) return [];
  const actions: OverwriteAction[] = [];

  for (const clip of clips) {
    const cs = clip.startFrame;
    const ce = clipEndFrame(clip);

    if (ce <= regionStart || cs >= regionEnd) continue;

    if (cs >= regionStart && ce <= regionEnd) {
      actions.push({ kind: "remove", clipId: clip.id });
    } else if (cs < regionStart && ce > regionEnd) {
      const leftDuration = regionStart - cs;
      const rightStartFrame = regionEnd;
      const rightTrimStart = clip.trimStartFrame + Math.round((regionEnd - cs) * clip.speed);
      const rightDuration = ce - regionEnd;
      actions.push({
        kind: "split",
        clipId: clip.id,
        leftDuration,
        rightId: crypto.randomUUID(),
        rightStartFrame,
        rightTrimStart,
        rightDuration,
      });
    } else if (cs < regionStart) {
      // Overlaps left side — trim right edge
      const newDuration = regionStart - cs;
      actions.push({ kind: "trimEnd", clipId: clip.id, newDuration });
    } else {
      // Overlaps right side — trim left edge
      const trimAmount = regionEnd - cs;
      const newStartFrame = regionEnd;
      const newTrimStart = clip.trimStartFrame + Math.round(trimAmount * clip.speed);
      const newDuration = ce - regionEnd;
      actions.push({ kind: "trimStart", clipId: clip.id, newStartFrame, newTrimStart, newDuration });
    }
  }

  return actions;
}

/** Apply overwrite actions immutably, returning a new sorted clip array. */
export function applyOverwriteToClips(clips: Clip[], actions: OverwriteAction[]): Clip[] {
  if (actions.length === 0) return clips;

  const removeIds = new Set<string>();
  const updates = new Map<string, Clip>();
  const additions: Clip[] = [];

  for (const action of actions) {
    if (action.kind === "remove") {
      removeIds.add(action.clipId);
    } else if (action.kind === "trimEnd") {
      const orig = updates.get(action.clipId) ?? clips.find((c) => c.id === action.clipId);
      if (orig) updates.set(action.clipId, setDuration(orig, action.newDuration));
    } else if (action.kind === "trimStart") {
      const orig = updates.get(action.clipId) ?? clips.find((c) => c.id === action.clipId);
      if (orig) {
        updates.set(
          action.clipId,
          setDuration(
            { ...orig, startFrame: action.newStartFrame, trimStartFrame: action.newTrimStart },
            action.newDuration,
          ),
        );
      }
    } else if (action.kind === "split") {
      const orig = updates.get(action.clipId) ?? clips.find((c) => c.id === action.clipId);
      if (orig) {
        updates.set(action.clipId, setDuration(orig, action.leftDuration));
        additions.push(
          setDuration(
            {
              ...orig,
              id: action.rightId,
              startFrame: action.rightStartFrame,
              trimStartFrame: action.rightTrimStart,
            },
            action.rightDuration,
          ),
        );
      }
    }
  }

  const result: Clip[] = [];
  for (const clip of clips) {
    if (removeIds.has(clip.id)) continue;
    result.push(updates.get(clip.id) ?? clip);
  }
  result.push(...additions);
  result.sort((a, b) => a.startFrame - b.startFrame);
  return result;
}
