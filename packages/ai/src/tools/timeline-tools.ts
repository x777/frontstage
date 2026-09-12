import { z } from "zod";
import {
  changeTimelineMarkersCommand,
  defaultTimelineMarker,
  rgbaFromHex,
  rgbaToHex,
  MARKER_COMMENT_MAX,
  MARKER_NAME_MAX,
  markerEndFrame,
} from "@frontstage/core";
import type { TimelineMarker } from "@frontstage/core";
import type { ToolSpec } from "./types.js";
import { ok, errorResult } from "./executor.js";

function markerPayload(marker: TimelineMarker): Record<string, unknown> {
  return {
    markerId: marker.id,
    name: marker.name,
    startFrame: marker.startFrame,
    endFrame: markerEndFrame(marker),
    durationFrames: marker.durationFrames,
    color: rgbaToHex(marker.color),
    comment: marker.comment,
    status: marker.status,
  };
}

export function createTimelineTool(): ToolSpec {
  return {
    name: "create_timeline",
    description:
      "Creates a timeline and switches to it — every read and edit tool now targets it. Without 'from', the new timeline is empty and inherits fps/resolution from the previously active one. With 'from', it's a full copy of that timeline — the versioning primitive: copy, then edit the copy while the original stays intact; every clip and track id in the copy is NEW, so re-read get_timeline before editing. Undoable.",
    inputSchema: z.object({
      name: z.string().optional(),
      from: z.string().optional(),
    }),
    run(args, ctx) {
      const { name, from } = args as { name?: string; from?: string };
      if (from) {
        const source = ctx.store.timelineById(from);
        if (!source) return errorResult(`No timeline with id '${from}'. get_media lists the project's timelines.`);
        const id = ctx.store.duplicateTimeline(from);
        if (!id) return errorResult(`Couldn't duplicate "${source.name ?? from}".`);
        if (name?.trim()) ctx.store.renameTimeline(id, name);
        const displayName = ctx.store.timelineById(id)?.name ?? "";
        return ok(
          JSON.stringify({
            timelineId: id,
            name: displayName,
            active: true,
            note: `Duplicated "${source.name ?? from}" and switched to the copy. Its clip and track ids are new — re-read get_timeline before editing.`,
          }),
        );
      }
      const id = ctx.store.createTimeline(name);
      return ok(
        JSON.stringify({
          timelineId: id,
          name: ctx.store.timelineById(id)?.name ?? "",
          active: true,
          note: "Empty and now active; all edit tools target it.",
        }),
      );
    },
  };
}

export function setActiveTimelineTool(): ToolSpec {
  return {
    name: "set_active_timeline",
    description:
      "Switches the active timeline — the one every read and edit tool targets and the one the user sees. get_media lists the project's timelines (with timelineId). Always re-read get_timeline after switching; clip and track ids from the previous timeline are no longer valid targets.",
    inputSchema: z.object({
      timelineId: z.string(),
    }),
    run(args, ctx) {
      const { timelineId } = args as { timelineId: string };
      const target = ctx.store.timelineById(timelineId);
      if (!target) {
        return errorResult(`No timeline with id '${timelineId}'. get_media lists the project's timelines.`);
      }
      const already = ctx.store.getSnapshot().activeTimelineId === target.id;
      if (!already) ctx.store.activateTimeline(target.id!);
      return ok(
        JSON.stringify({
          timelineId: target.id,
          name: target.name ?? "",
          active: true,
          totalFrames: target.tracks.reduce((max, t) => {
            const end = t.clips.reduce((m, c) => Math.max(m, c.startFrame + c.durationFrames), 0);
            return Math.max(max, end);
          }, 0),
          fps: target.fps,
          trackCount: target.tracks.length,
          note: already
            ? "Already the active timeline."
            : "Re-read get_timeline — clip and track ids from the previous timeline no longer apply.",
        }),
      );
    },
  };
}

export function manageMarkersTool(): ToolSpec {
  return {
    name: "manage_markers",
    description:
      "Creates, updates, or deletes one persistent timeline marker. A zero duration marks one frame; a positive duration is half-open. Status tracks the review workflow: open is awaiting work, review is ready for user approval, and resolved is accepted. Set review only after applying and verifying the requested edit. Set resolved only when the user explicitly approves or requests it.",
    inputSchema: z.object({
      action: z.enum(["create", "update", "delete"]),
      markerId: z.string().optional(),
      name: z.string().optional(),
      startFrame: z.number().int().optional(),
      durationFrames: z.number().int().optional(),
      color: z.string().optional(),
      comment: z.string().optional(),
      status: z.enum(["open", "review", "resolved"]).optional(),
    }),
    run(args, ctx) {
      const a = args as {
        action: "create" | "update" | "delete";
        markerId?: string;
        name?: string;
        startFrame?: number;
        durationFrames?: number;
        color?: string;
        comment?: string;
        status?: "open" | "review" | "resolved";
      };
      const parseColor = (raw: string | undefined) => {
        if (raw === undefined) return undefined;
        const parsed = rgbaFromHex(raw);
        if (!parsed) throw new Error("color must be #RGB, #RRGGBB, or #RRGGBBAA.");
        return parsed;
      };
      try {
        if (a.action === "create") {
          if (a.name === undefined || a.startFrame === undefined) {
            return errorResult("create requires name and startFrame.");
          }
          const marker = defaultTimelineMarker({
            name: a.name,
            startFrame: a.startFrame,
            durationFrames: a.durationFrames,
            color: parseColor(a.color),
            comment: a.comment,
            status: a.status,
          });
          ctx.store.dispatch(changeTimelineMarkersCommand({ creates: [marker] }, "Add Marker (Agent)"));
          const created = (ctx.store.getSnapshot().timeline.markers ?? []).find((m) => m.id === marker.id);
          return ok(JSON.stringify(created ? { created: markerPayload(created) } : { noOp: true }));
        }
        if (a.action === "update") {
          const hasPatch =
            a.name !== undefined ||
            a.startFrame !== undefined ||
            a.durationFrames !== undefined ||
            a.color !== undefined ||
            a.comment !== undefined ||
            a.status !== undefined;
          if (!a.markerId || !hasPatch) {
            return errorResult("update requires markerId and at least one field to change.");
          }
          const existing = (ctx.store.getSnapshot().timeline.markers ?? []).find((m) => m.id === a.markerId);
          if (!existing) return errorResult(`Unknown markerId '${a.markerId}'.`);
          const next: TimelineMarker = {
            ...existing,
            name: a.name ?? existing.name,
            startFrame: a.startFrame ?? existing.startFrame,
            durationFrames: a.durationFrames ?? existing.durationFrames,
            color: parseColor(a.color) ?? existing.color,
            comment: a.comment ?? existing.comment,
            status: a.status ?? existing.status,
          };
          ctx.store.dispatch(changeTimelineMarkersCommand({ updates: [next] }, "Change Marker (Agent)"));
          const updated = (ctx.store.getSnapshot().timeline.markers ?? []).find((m) => m.id === next.id);
          return ok(JSON.stringify(updated ? { updated: markerPayload(updated) } : { noOp: true }));
        }
        if (!a.markerId) return errorResult("delete requires markerId.");
        ctx.store.dispatch(changeTimelineMarkersCommand({ deleteIds: [a.markerId] }, "Delete Marker (Agent)"));
        return ok(JSON.stringify({ deletedMarkerId: a.markerId }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === "invalidName") {
          return errorResult(`Marker names must be non-empty single lines of at most ${MARKER_NAME_MAX} characters.`);
        }
        if (msg === "invalidComment") {
          return errorResult(`Marker comments must be at most ${MARKER_COMMENT_MAX} characters.`);
        }
        if (msg === "invalidRange" || msg.startsWith("color must")) {
          return errorResult(msg.startsWith("color") ? msg : "Marker frames must be non-negative integer ranges and every ID must exist.");
        }
        return errorResult(msg);
      }
    },
  };
}
