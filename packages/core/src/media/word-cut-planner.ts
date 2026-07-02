import type { FrameRange } from "../timeline/ripple-types.js";
import { mergeRanges } from "../timeline/ripple-engine.js";
import type { TimelineWord } from "./timeline-words.js";

export type CutAggressiveness = "tight" | "balanced" | "loose";

const keptGapMs: Record<CutAggressiveness, number> = { tight: 60, balanced: 150, loose: 320 };

/** Swift CutAggressiveness.keptGapMs -> msToFrames(ms, fps) = Int((ms/1000*fps).rounded()). */
export function keptGapFrames(a: CutAggressiveness, fps: number): number {
  return Math.round((keptGapMs[a] / 1000) * fps);
}

/**
 * 1:1 port of Swift's WordCutPlanner.cutRanges(words:clipStart:clipEnd:keepGapFrames:). Swift's
 * `words` there is every word in one clip (selected and kept) with a `selected` flag; TimelineWord
 * has no such flag (fixed by the T1 brief), so it's carried separately as `selected` (the set of
 * chosen TimelineWord.index values) — dropping it and inferring runs from a selected-only word
 * list would use the wrong (too-distant) neighbour as the run's pad boundary and can delete
 * unselected words sitting closer than half the kept gap. `words` MUST be one contiguous,
 * same-track scope (typically one clip) in index order — selected and kept words both included.
 *
 * Exact Swift source (WordCutPlanner.swift):
 *   let words = words.filter { $0.endFrame > $0.startFrame }
 *   guard clipEnd > clipStart, !words.isEmpty else { return [] }
 *   let half = max(0, keepGapFrames / 2)
 *   var k = 0
 *   while k < words.count {
 *       guard words[k].selected else { k += 1; continue }
 *       var l = k
 *       while l + 1 < words.count, words[l + 1].selected { l += 1 }
 *       let left = k > 0 ? words[k - 1].endFrame : clipStart
 *       let right = l + 1 < words.count ? words[l + 1].startFrame : clipEnd
 *       let runStart = words[k].startFrame, runEnd = words[l].endFrame
 *       let keepBefore = min(max(0, runStart - left), half)
 *       let keepAfter = min(max(0, right - runEnd), half)
 *       let start = max(clipStart, min(left + keepBefore, runStart))
 *       let end = min(clipEnd, max(runEnd, right - keepAfter))
 *       if end > start { ranges.append(FrameRange(start: start, end: end)) }
 *       k = l + 1
 *   }
 *   return RippleEngine.mergeRanges(ranges)
 */
export function cutRanges(
  words: TimelineWord[],
  selected: ReadonlySet<number>,
  clipStart: number,
  clipEnd: number,
  keepGapFrames: number,
): FrameRange[] {
  const filtered = words.filter((w) => w.endFrame > w.startFrame);
  if (clipEnd <= clipStart || filtered.length === 0) return [];
  const half = Math.max(0, Math.floor(keepGapFrames / 2));
  const ranges: FrameRange[] = [];
  let k = 0;
  while (k < filtered.length) {
    if (!selected.has(filtered[k]!.index)) {
      k += 1;
      continue;
    }
    let l = k;
    while (l + 1 < filtered.length && selected.has(filtered[l + 1]!.index)) l += 1;
    const left = k > 0 ? filtered[k - 1]!.endFrame : clipStart;
    const right = l + 1 < filtered.length ? filtered[l + 1]!.startFrame : clipEnd;
    const runStart = filtered[k]!.startFrame;
    const runEnd = filtered[l]!.endFrame;
    const keepBefore = Math.min(Math.max(0, runStart - left), half);
    const keepAfter = Math.min(Math.max(0, right - runEnd), half);
    const start = Math.max(clipStart, Math.min(left + keepBefore, runStart));
    const end = Math.min(clipEnd, Math.max(runEnd, right - keepAfter));
    if (end > start) ranges.push({ start, end });
    k = l + 1;
  }
  return mergeRanges(ranges);
}
