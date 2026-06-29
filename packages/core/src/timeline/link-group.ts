import type { Timeline } from "../timeline.js";
import { findClip } from "../timeline.js";
import type { ClipShift } from "./ripple-types.js";

// Reverse link-group index: groupId -> clip ids, in one O(tracks·clips) pass.
export function linkIndex(timeline: Timeline): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const t of timeline.tracks) {
    for (const c of t.clips) {
      if (c.linkGroupId != null) {
        const arr = m.get(c.linkGroupId);
        if (arr) arr.push(c.id);
        else m.set(c.linkGroupId, [c.id]);
      }
    }
  }
  return m;
}

export function expandToLinkGroup(timeline: Timeline, ids: ReadonlySet<string>): Set<string> {
  const idx = linkIndex(timeline);
  const clipToGroup = new Map<string, string>();
  for (const [gid, members] of idx) for (const id of members) clipToGroup.set(id, gid);
  const groups = new Set<string>();
  for (const id of ids) {
    const g = clipToGroup.get(id);
    if (g) groups.add(g);
  }
  const result = new Set(ids);
  if (groups.size === 0) return result;
  for (const g of groups) {
    const members = idx.get(g);
    if (members) for (const m of members) result.add(m);
  }
  return result;
}

export function linkedPartnerIds(timeline: Timeline, clipId: string): string[] {
  for (const members of linkIndex(timeline).values()) {
    if (members.includes(clipId)) return members.filter((id) => id !== clipId);
  }
  return [];
}

export function timingPropagationPartners(timeline: Timeline, clipIds: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const id of clipIds) {
    for (const pid of linkedPartnerIds(timeline, id)) {
      if (!clipIds.has(pid)) out.add(pid);
    }
  }
  return out;
}

// Partner shifts that keep linked clips in sync when the lead moves to `toFrame`.
export function partnerMoves(timeline: Timeline, clipId: string, toFrame: number): ClipShift[] {
  const lead = findClip(timeline, clipId);
  if (!lead) return [];
  const current = timeline.tracks[lead.trackIndex]!.clips[lead.clipIndex]!.startFrame;
  const delta = toFrame - current;
  if (delta === 0) return [];
  const moves: ClipShift[] = [];
  for (const pid of linkedPartnerIds(timeline, clipId)) {
    const pl = findClip(timeline, pid);
    if (!pl) continue;
    const p = timeline.tracks[pl.trackIndex]!.clips[pl.clipIndex]!;
    moves.push({ clipId: pid, newStartFrame: Math.max(0, p.startFrame + delta) });
  }
  return moves;
}

export function linkGroupOffsets(timeline: Timeline): Map<string, number> {
  const byGroup = new Map<string, { id: string; start: number }[]>();
  for (const t of timeline.tracks) {
    for (const c of t.clips) {
      if (c.linkGroupId == null) continue;
      const entry = { id: c.id, start: c.startFrame - c.trimStartFrame };
      const arr = byGroup.get(c.linkGroupId);
      if (arr) arr.push(entry);
      else byGroup.set(c.linkGroupId, [entry]);
    }
  }
  const offsets = new Map<string, number>();
  for (const entries of byGroup.values()) {
    if (entries.length <= 1) continue;
    const ref = Math.min(...entries.map((e) => e.start));
    for (const e of entries) {
      const d = e.start - ref;
      if (d !== 0) offsets.set(e.id, d);
    }
  }
  return offsets;
}

export function canUnlinkClips(timeline: Timeline, ids: ReadonlySet<string>): boolean {
  for (const t of timeline.tracks) {
    for (const c of t.clips) {
      if (ids.has(c.id) && c.linkGroupId != null) return true;
    }
  }
  return false;
}

export function canLinkClips(timeline: Timeline, ids: ReadonlySet<string>): boolean {
  if (ids.size < 2) return false;
  const types = new Set<string>();
  const groups = new Set<string>();
  let ungrouped = 0;
  for (const t of timeline.tracks) {
    for (const c of t.clips) {
      if (ids.has(c.id)) {
        types.add(c.mediaType);
        if (c.linkGroupId != null) groups.add(c.linkGroupId);
        else ungrouped++;
      }
    }
  }
  if (types.size < 2) return false;
  return !(groups.size === 1 && ungrouped === 0);
}
