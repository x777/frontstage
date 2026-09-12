import { z } from "zod";
import {
  manageTracksCommand,
  normalizeTrackName,
  removeTrackCommand,
  reorderTrackLive,
  timelineTrackDisplayLabel,
  TRACK_NAME_MAX_LENGTH,
  type ManageTracksPlan,
  type Timeline,
  type Track,
  type TrackSetUpdate,
} from "@frontstage/core";
import type { ToolSpec } from "./types.js";
import { ok, errorResult, asUndoStep } from "./executor.js";

export function removeTracksTool(): ToolSpec {
  return {
    name: "remove_tracks",
    description: "Removes one or more tracks from the timeline by id. All removals are one undo step.",
    inputSchema: z.object({
      trackIds: z.array(z.string()).min(1),
    }),
    run(args, ctx) {
      const { trackIds } = args as { trackIds: string[] };
      const tl = ctx.store.getSnapshot().timeline;

      for (const id of trackIds) {
        if (!tl.tracks.find((t) => t.id === id)) return errorResult(`unknown track: ${id}`);
      }

      asUndoStep(
        ctx.store,
        "Remove Tracks",
        trackIds.map((id) => { const cmd = removeTrackCommand(id); return cmd.apply.bind(cmd); }),
      );

      return ok(`Removed ${trackIds.length} track(s): ${trackIds.join(", ")}`);
    },
  };
}

const trackSelectorSchema = z.object({
  trackId: z.string().optional(),
  index: z.number().int().optional(),
});

type TrackSelector = { trackId?: string; index?: number };

function resolveTrackId(entry: TrackSelector, path: string, tracks: Track[]): string | { error: string } {
  if (typeof entry.trackId === "string") {
    if (entry.index !== undefined || !tracks.some((t) => t.id === entry.trackId)) {
      return { error: `${path}: pass one current trackId or index` };
    }
    return entry.trackId;
  }
  if (entry.index === undefined) return { error: `${path}: pass one current trackId or index` };
  if (entry.index < 0 || entry.index >= tracks.length) {
    return { error: `${path}: track index ${entry.index} out of range (timeline has ${tracks.length} tracks)` };
  }
  return tracks[entry.index]!.id;
}

function trackReceipt(timeline: Timeline, i: number): Record<string, unknown> {
  const track = timeline.tracks[i]!;
  const entry: Record<string, unknown> = {
    trackId: track.id,
    index: i,
    label: timelineTrackDisplayLabel(timeline, i),
    type: track.type,
  };
  if (track.name) entry.name = track.name;
  if (track.muted) entry.muted = true;
  if (track.hidden) entry.hidden = true;
  if (!track.syncLocked) entry.syncLocked = false;
  return entry;
}

export function manageTracksTool(): ToolSpec {
  return {
    name: "manage_tracks",
    description:
      "Reorders, names, configures, or removes tracks in one undoable action. Prefer stable trackId selectors; numeric indexes use the order at call time. Index 0 renders on top, and reorder destinations must stay within the track's video/audio zone. Arrays run reorder → set → remove. User-authored names are returned separately from generated V1/A1 labels. Returns receipts and the resulting track order.",
    inputSchema: z.object({
      reorder: z
        .array(trackSelectorSchema.extend({ to: z.number().int() }))
        .optional(),
      set: z
        .array(
          trackSelectorSchema.extend({
            muted: z.boolean().optional(),
            hidden: z.boolean().optional(),
            syncLocked: z.boolean().optional(),
            name: z.string().optional(),
          }),
        )
        .optional(),
      remove: z.array(z.union([z.number().int(), trackSelectorSchema])).optional(),
    }),
    run(args, ctx) {
      const { reorder = [], set = [], remove = [] } = args as {
        reorder?: Array<TrackSelector & { to: number }>;
        set?: Array<TrackSelector & { muted?: boolean; hidden?: boolean; syncLocked?: boolean; name?: string }>;
        remove?: Array<number | TrackSelector>;
      };
      const tl = ctx.store.getSnapshot().timeline;
      const tracks = tl.tracks;

      const reorders: { id: string; to: number }[] = [];
      for (let i = 0; i < reorder.length; i++) {
        const entry = reorder[i]!;
        const path = `reorder[${i}]`;
        const id = resolveTrackId(entry, path, tracks);
        if (typeof id !== "string") return errorResult(id.error);
        const from = tracks.findIndex((t) => t.id === id);
        if (from < 0 || entry.to < 0 || entry.to >= tracks.length || tracks[from]!.type !== tracks[entry.to]!.type) {
          return errorResult(`${path}: destination index ${entry.to} is outside the track's type zone`);
        }
        reorders.push({ id, to: entry.to });
      }

      const updates: TrackSetUpdate[] = [];
      for (let i = 0; i < set.length; i++) {
        const entry = set[i]!;
        const path = `set[${i}]`;
        const includesName = entry.name !== undefined;
        if (entry.muted === undefined && entry.hidden === undefined && entry.syncLocked === undefined && !includesName) {
          return errorResult(`${path}: pass at least one of muted, hidden, syncLocked, name`);
        }
        let name: string | undefined;
        if (includesName) {
          const parsed = normalizeTrackName(entry.name);
          if (!parsed.ok) {
            return errorResult(`${path}.name must be one line of at most ${TRACK_NAME_MAX_LENGTH} characters`);
          }
          name = parsed.name;
        }
        const id = resolveTrackId(entry, path, tracks);
        if (typeof id !== "string") return errorResult(id.error);
        updates.push({ id, muted: entry.muted, hidden: entry.hidden, syncLocked: entry.syncLocked, name, includesName });
      }

      const removeIds: string[] = [];
      for (let i = 0; i < remove.length; i++) {
        const raw = remove[i]!;
        const path = `remove[${i}]`;
        const entry: TrackSelector = typeof raw === "number" ? { index: raw } : raw;
        const id = resolveTrackId(entry, path, tracks);
        if (typeof id !== "string") return errorResult(id.error);
        removeIds.push(id);
      }

      if (reorders.length === 0 && updates.length === 0 && removeIds.length === 0) {
        return errorResult("Nothing to do — pass at least one of reorder, set, remove.");
      }

      const removeIdSet = new Set(removeIds);
      const removedTracks = tracks.flatMap((track, i) =>
        removeIdSet.has(track.id) ? [trackReceipt(tl, i)] : [],
      );

      const reorderResults: { trackId: string; from: number; to: number; changed: boolean }[] = [];
      let sim = tl;
      for (const r of reorders) {
        const from = sim.tracks.findIndex((t) => t.id === r.id);
        sim = reorderTrackLive(sim, r.id, r.to);
        const dest = sim.tracks.findIndex((t) => t.id === r.id);
        reorderResults.push({ trackId: r.id, from, to: dest, changed: from !== dest });
      }

      const plan: ManageTracksPlan = { reorders, updates, removeIds };
      ctx.store.dispatch(manageTracksCommand(plan));
      const after = ctx.store.getSnapshot().timeline;

      const renamed = updates
        .filter((u) => u.includesName)
        .map((u) => {
          const track = after.tracks.find((t) => t.id === u.id);
          const before = tracks.find((t) => t.id === u.id);
          return {
            trackId: u.id,
            name: track?.name ?? null,
            changed: (before?.name ?? undefined) !== (track?.name ?? undefined),
          };
        });

      const extra: Record<string, unknown> = {
        tracks: after.tracks.map((_, i) => trackReceipt(after, i)),
      };
      if (reorderResults.length > 0) extra.reordered = reorderResults;
      if (renamed.length > 0) extra.renamed = renamed;
      if (removedTracks.length > 0) extra.removedTracks = removedTracks;
      return ok(JSON.stringify(extra, null, 2));
    },
  };
}
