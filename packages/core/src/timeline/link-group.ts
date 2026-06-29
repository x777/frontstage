import type { Timeline } from "../timeline.js";

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
