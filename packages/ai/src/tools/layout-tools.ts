import { z } from "zod";
import {
  addClipCommand,
  findClip,
  insertTrackCommand,
  replaceClip,
  timelineTrackDisplayLabel,
  videoLayouts,
  layoutAnchors,
  layoutPlacement,
  planAgentResolutionAdoption,
  LAYOUT_IDS,
  type LayoutFit,
  type LayoutSlot,
  type MediaManifestEntry,
  type Timeline,
} from "@frontstage/core";
import type { ToolSpec } from "./types.js";
import { ok, errorResult, asUndoStep } from "./executor.js";

// Ported from Swift ToolExecutor+Layout.swift's `applyLayout` + the `apply_layout` ToolDefinitions
// entry (#226). Validation order, error text, and the result summary follow Swift verbatim. The
// media-placement mode inherits M14C T2's resolution auto-match (planAgentResolutionAdoption) via
// the layout's canonical slot order, same as Swift's `layout.slots.compactMap`.

const slotEntrySchema = z.object({
  slot: z.string(),
  mediaRef: z.string().optional(),
  clipIds: z.array(z.string()).optional(),
  anchor: z.string().optional(),
  anchorX: z.number().finite().optional(),
  anchorY: z.number().finite().optional(),
});

type SlotEntryInput = z.infer<typeof slotEntrySchema>;

interface ApplyLayoutArgs {
  layout: string;
  slots: SlotEntryInput[];
  startFrame?: number;
  durationFrames?: number;
  fit?: string;
}

function resolveAnchor(e: SlotEntryInput, path: string): { anchor: { x: number; y: number } } | { error: string } {
  const anchor = { ...layoutAnchors.center! };
  if (e.anchor !== undefined) {
    const named = layoutAnchors[e.anchor];
    if (!named) {
      return {
        error: `${path}: invalid anchor '${e.anchor}'. Valid: ${Object.keys(layoutAnchors).sort().join(", ")}, or anchorX/anchorY for in-between values.`,
      };
    }
    anchor.x = named.x;
    anchor.y = named.y;
  }
  for (const [axis, v] of [["anchorX", e.anchorX] as const, ["anchorY", e.anchorY] as const]) {
    if (v !== undefined && (v < 0 || v > 1)) {
      return { error: `${path}: ${axis} must be between 0 and 1 (got ${v})` };
    }
  }
  if (e.anchorX !== undefined) anchor.x = e.anchorX;
  if (e.anchorY !== undefined) anchor.y = e.anchorY;
  return { anchor };
}

export function applyLayoutTool(): ToolSpec {
  return {
    name: "apply_layout",
    description:
      "Arranges multiple clips into a common multi-video layout (split screen, picture-in-picture, grid) in one undoable action. Pick a named layout and assign a clip to each of its slots; the tool computes every transform and crop so each clip fills its region edge-to-edge without stretching (cover-crop), or pass fit='fit' to letterbox the whole source inside its slot instead. The crop is centered by default; bias it with a slot's 'anchor' (a coarse shortcut) or anchorX/anchorY (0-1, continuous). Two modes, don't mix across slots: give each slot a 'mediaRef' to place a new clip (creates one stacked video track per slot at startFrame/durationFrames, with linked audio), or give each slot 'clipIds' to re-layout one or more existing clips into that slot (only transform/crop change; timing and tracks are untouched). Every slot of the chosen layout must be filled. Layouts and their slots: full — main; side_by_side — left, right; top_bottom — top, bottom; pip_bottom_right/pip_bottom_left/pip_top_right/pip_top_left — main, inset; grid_2x2 — top_left, top_right, bottom_left, bottom_right; main_sidebar — main (70%), sidebar (30%); three_up — left, center, right.",
    inputSchema: z.object({
      layout: z.string(),
      slots: z.array(slotEntrySchema),
      startFrame: z.number().int().optional(),
      durationFrames: z.number().int().optional(),
      fit: z.string().optional(),
    }),
    run(args, ctx) {
      const a = args as ApplyLayoutArgs;

      const layoutSlots = videoLayouts[a.layout];
      if (!layoutSlots) {
        return errorResult(`unknown layout '${a.layout}'. Valid: ${LAYOUT_IDS.join(", ")}`);
      }

      const fitRaw = a.fit ?? "fill";
      if (fitRaw !== "fill" && fitRaw !== "fit") {
        return errorResult(`invalid fit '${fitRaw}'. Valid: fill, fit`);
      }
      const fit = fitRaw as LayoutFit;

      if (a.slots.length === 0) return errorResult("apply_layout needs a non-empty 'slots' array");

      const slotById = new Map(layoutSlots.map((s) => [s.id, s] as const));

      const seen = new Set<string>();
      const seenClips = new Set<string>();
      let usesMedia = false;
      let usesClip = false;
      const entries: { slot: LayoutSlot; entry: SlotEntryInput; anchor: { x: number; y: number } }[] = [];

      for (let i = 0; i < a.slots.length; i++) {
        const e = a.slots[i]!;
        const slot = slotById.get(e.slot);
        if (!slot) {
          return errorResult(
            `slots[${i}]: '${e.slot}' is not a slot of layout '${a.layout}'. Slots: ${layoutSlots.map((s) => s.id).join(", ")}`,
          );
        }
        if (seen.has(e.slot)) return errorResult(`slots[${i}]: duplicate slot '${e.slot}'`);
        seen.add(e.slot);

        const hasMedia = e.mediaRef !== undefined;
        const hasClip = e.clipIds !== undefined;
        if (hasMedia === hasClip) return errorResult(`slots[${i}]: provide exactly one of 'mediaRef' or 'clipIds'`);

        if (hasClip) {
          if (e.clipIds!.length === 0) return errorResult(`slots[${i}]: 'clipIds' must not be empty`);
          for (const cid of e.clipIds!) {
            if (seenClips.has(cid)) {
              return errorResult(`slots[${i}]: clip '${cid}' is assigned to more than one slot; each clip can fill only one.`);
            }
            seenClips.add(cid);
          }
        }
        usesMedia = usesMedia || hasMedia;
        usesClip = usesClip || hasClip;

        const anchorResult = resolveAnchor(e, `slots[${i}]`);
        if ("error" in anchorResult) return errorResult(anchorResult.error);
        entries.push({ slot, entry: e, anchor: anchorResult.anchor });
      }

      const missing = [...slotById.keys()].filter((id) => !seen.has(id)).sort();
      if (missing.length > 0) {
        return errorResult(`layout '${a.layout}' needs every slot filled. Missing: ${missing.join(", ")}`);
      }
      if (usesMedia && usesClip) {
        return errorResult(
          "apply_layout: don't mix 'mediaRef' and 'clipIds' — either place new clips (all mediaRef) or re-layout existing clips (all clipIds).",
        );
      }

      const tl = ctx.store.getSnapshot().timeline;
      const fps = tl.fps;
      const canvasW = tl.width;
      const canvasH = tl.height;
      const manifest = ctx.getManifest();

      const startFrame = a.startFrame ?? 0;
      const duration = a.durationFrames ?? 0;

      const assetBySlot = new Map<string, MediaManifestEntry>();
      if (usesMedia) {
        if (startFrame < 0) return errorResult(`startFrame must be >= 0 (got ${startFrame})`);
        if (duration < 1) return errorResult("apply_layout placing new clips requires durationFrames >= 1.");
        for (const e of entries) {
          const found = manifest.entries.find((en) => en.id === e.entry.mediaRef);
          if (!found) return errorResult(`Media asset not found: ${e.entry.mediaRef}`);
          if (found.type !== "video" && found.type !== "image") {
            return errorResult(`slot '${e.slot.id}': asset ${e.entry.mediaRef} is ${found.type}; layout slots take video or image.`);
          }
          assetBySlot.set(e.slot.id, found);
        }
      } else {
        const rangesByTrack = new Map<string, { slot: string; start: number; end: number }[]>();
        const intervalsBySlot = new Map<string, { start: number; end: number }[]>();
        for (const e of entries) {
          for (const cid of e.entry.clipIds!) {
            const loc = findClip(tl, cid);
            if (!loc) return errorResult(`slot '${e.slot.id}': clip not found: ${cid}`);
            const clip = tl.tracks[loc.trackIndex]!.clips[loc.clipIndex]!;
            if (clip.mediaType !== "video" && clip.mediaType !== "image") {
              return errorResult(`slot '${e.slot.id}': clip ${cid} is ${clip.mediaType}; layout applies to video/image clips.`);
            }
            const trackId = tl.tracks[loc.trackIndex]!.id;
            const start = clip.startFrame;
            const end = clip.startFrame + clip.durationFrames;
            const existingRanges = rangesByTrack.get(trackId) ?? [];
            for (const other of existingRanges) {
              if (other.slot !== e.slot.id && start < other.end && other.start < end) {
                return errorResult(
                  `clips in slots '${other.slot}' and '${e.slot.id}' are on the same track and their times overlap; only the first would render. Move them to separate tracks (or place new clips with mediaRef) so every region shows.`,
                );
              }
            }
            existingRanges.push({ slot: e.slot.id, start, end });
            rangesByTrack.set(trackId, existingRanges);
            const ivs = intervalsBySlot.get(e.slot.id) ?? [];
            ivs.push({ start, end });
            intervalsBySlot.set(e.slot.id, ivs);
          }
        }
        if (entries.length > 1) {
          const allIntervals = [...intervalsBySlot.values()];
          const candidates = allIntervals.flatMap((ivs) => ivs.map((iv) => iv.start));
          const coincides = candidates.some((f) => allIntervals.every((ivs) => ivs.some((iv) => iv.start <= f && f < iv.end)));
          if (!coincides) {
            return errorResult(
              "the selected clips never play at the same time, so no single frame shows every region. Overlap their timeline ranges (or place new clips with mediaRef) before laying them out.",
            );
          }
        }
      }

      // Resolution auto-match (#233 standing rule: fps is never adopted here) — a separate undo
      // step ahead of the layout, mirroring Swift's applySettingsIfNeededForAgent. Asset order is
      // the layout's canonical slot order (not the caller's slot order), matching Swift's
      // `layout.slots.compactMap { assetBySlot[$0.id] }`.
      let settingsNote: string | null = null;
      let effTl = tl;
      let effFps = fps;
      let effCanvasW = canvasW;
      let effCanvasH = canvasH;
      if (usesMedia) {
        const orderedAssets = layoutSlots
          .map((s) => assetBySlot.get(s.id))
          .filter((e): e is MediaManifestEntry => e !== undefined);
        const adoption = planAgentResolutionAdoption(tl, manifest, orderedAssets);
        if (adoption.command) {
          ctx.store.dispatch(adoption.command);
          effTl = ctx.store.getSnapshot().timeline;
          effFps = effTl.fps;
          effCanvasW = effTl.width;
          effCanvasH = effTl.height;
        }
        settingsNote = adoption.note;
      }

      // --- mutation (validated above; everything below is a single undo step) ---

      const tracksBefore = new Set(effTl.tracks.map((t) => t.id));
      const reducers: ((t: Timeline) => Timeline)[] = [];
      const summaries: string[] = [];
      const clipsBySlot = new Map<string, string[]>();

      if (usesMedia) {
        const mediaSlotsSortedByZ = [...layoutSlots].sort((x, y) => x.z - y.z);
        const trackIdBySlot = new Map<string, string>();
        for (const slot of mediaSlotsSortedByZ) trackIdBySlot.set(slot.id, ctx.newId());
        for (const slot of mediaSlotsSortedByZ) {
          const trackId = trackIdBySlot.get(slot.id)!;
          const cmd = insertTrackCommand(0, "video", () => trackId);
          reducers.push(cmd.apply.bind(cmd));
        }

        for (const e of entries) {
          const trackId = trackIdBySlot.get(e.slot.id)!;
          const assetEntry = assetBySlot.get(e.slot.id)!;
          const videoClipId = ctx.newId();
          const shouldLink = assetEntry.type === "video" && assetEntry.hasAudio === true;
          // Pre-generated in addClipCommand's internal call order: visual clip, linkGroupId, audio
          // clip, and (only if a fresh audio track turns out to be needed) the new audio track id.
          const linkGroupId = shouldLink ? ctx.newId() : undefined;
          const audioClipId = shouldLink ? ctx.newId() : undefined;
          const audioTrackId = shouldLink ? ctx.newId() : undefined;
          clipsBySlot.set(e.slot.id, [videoClipId]);
          summaries.push(`${e.slot.id} → ${videoClipId}${audioClipId ? ` (+audio ${audioClipId})` : ""}`);

          reducers.push((t) => {
            const idx = t.tracks.findIndex((tr) => tr.id === trackId);
            if (idx === -1) return t;
            const seq = shouldLink ? [videoClipId, linkGroupId!, audioClipId!, audioTrackId!] : [videoClipId];
            let n = 0;
            const genId = () => seq[n++] ?? crypto.randomUUID();
            const cmd = addClipCommand(assetEntry, { kind: "existing", index: idx }, startFrame, effFps, undefined, genId, duration);
            return cmd.apply(t);
          });
        }
      } else {
        for (const e of entries) {
          clipsBySlot.set(e.slot.id, e.entry.clipIds!);
          summaries.push(`${e.slot.id} → ${e.entry.clipIds!.join(", ")}`);
        }
      }

      for (const e of entries) {
        for (const cid of clipsBySlot.get(e.slot.id) ?? []) {
          reducers.push((t) => {
            const loc = findClip(t, cid);
            if (!loc) return t;
            const clip = t.tracks[loc.trackIndex]!.clips[loc.clipIndex]!;
            const srcEntry = manifest.entries.find((en) => en.id === clip.mediaRef);
            const sourceW = srcEntry?.sourceWidth ?? 0;
            const sourceH = srcEntry?.sourceHeight ?? 0;
            const placement = layoutPlacement(sourceW, sourceH, e.slot, effCanvasW, effCanvasH, fit, e.anchor.x, e.anchor.y);
            return replaceClip(t, cid, (c) => ({
              ...c,
              transform: placement.transform,
              crop: placement.crop,
              positionTrack: undefined,
              scaleTrack: undefined,
              rotationTrack: undefined,
              cropTrack: undefined,
            }));
          });
        }
      }

      asUndoStep(ctx.store, "Apply Layout (Agent)", reducers);

      const finalTl = ctx.store.getSnapshot().timeline;
      const createdTracks = finalTl.tracks
        .map((t, i) => ({ t, i }))
        .filter(({ t }) => !tracksBefore.has(t.id))
        .map(({ t, i }) => `track ${i} ('${timelineTrackDisplayLabel(finalTl, i)}', ${t.type})`);

      let prefix = "";
      if (createdTracks.length > 0) prefix += `Created ${createdTracks.join(", ")}. `;
      if (settingsNote) prefix = `${settingsNote} ${prefix}`;
      const span = usesMedia ? ` at frame ${startFrame} for ${duration}` : " on existing clips";
      const tail = usesMedia ? "" : " Stacking follows current track order; reorder tracks if a PIP inset isn't on top.";
      return ok(`${prefix}Applied '${a.layout}' layout (${fit})${span}: ${summaries.join("; ")}.${tail}`);
    },
  };
}
