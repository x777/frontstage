import { z } from "zod";
import {
  findClip,
  buildColorStack,
  applyEffectStack,
  computeScopes,
  scopesGap,
  effectDescriptor,
  type ApplyColorInput,
  type Effect,
  type Timeline,
} from "@palmier/core";
import type { ToolBlock, ToolSpec } from "./types.js";
import { ok, errorResult, asUndoStep } from "./executor.js";

const numPair = z.array(z.tuple([z.number(), z.number()]));

const withStack = (s: Effect[]): Effect[] | undefined => (s.length ? s : undefined);

export function applyColorTool(): ToolSpec {
  return {
    name: "apply_color",
    description:
      "Sets the color grade on clips (exposure/contrast/temperature/etc., color wheels, curves, LUT). Rebuilds the color.* effect stack; non-color effects untouched. One undo step.",
    inputSchema: z.object({
      clipIds: z.array(z.string()).min(1),
      reset: z.boolean().optional(),
      exposure: z.number().optional(),
      contrast: z.number().optional(),
      saturation: z.number().optional(),
      vibrance: z.number().optional(),
      temperature: z.number().optional(),
      tint: z.number().optional(),
      highlights: z.number().optional(),
      shadows: z.number().optional(),
      blacks: z.number().optional(),
      whites: z.number().optional(),
      shadowsHue: z.number().optional(),
      shadowsAmount: z.number().optional(),
      shadowsLum: z.number().optional(),
      midsHue: z.number().optional(),
      midsAmount: z.number().optional(),
      midsGamma: z.number().optional(),
      highsHue: z.number().optional(),
      highsAmount: z.number().optional(),
      highsGain: z.number().optional(),
      masterCurve: numPair.optional(),
      redCurve: numPair.optional(),
      greenCurve: numPair.optional(),
      blueCurve: numPair.optional(),
      hueCurves: z
        .object({
          targets: z.array(
            z.object({
              targetHue: z.number(),
              hueShift: z.number().optional(),
              satScale: z.number().optional(),
              lumShift: z.number().optional(),
            }),
          ),
        })
        .optional(),
      lut: z.object({ path: z.string().optional(), strength: z.number().optional() }).optional(),
    }),
    run(args, ctx) {
      const input = args as ApplyColorInput;
      const tl = ctx.store.getSnapshot().timeline;
      for (const id of input.clipIds) {
        if (!findClip(tl, id)) return errorResult(`unknown clip: ${id}`);
      }
      const reducer = (t: Timeline): Timeline => ({
        ...t,
        tracks: t.tracks.map((tr) => ({
          ...tr,
          clips: tr.clips.map((c) =>
            input.clipIds.includes(c.id)
              ? { ...c, effects: withStack(buildColorStack(c.effects, input, ctx.newId)) }
              : c,
          ),
        })),
      });
      asUndoStep(ctx.store, "Color Grade (Agent)", [reducer]);
      return ok(`Applied color grade to ${input.clipIds.length} clip(s).`);
    },
  };
}

export function inspectColorTool(): ToolSpec {
  return {
    name: "inspect_color",
    description:
      "Renders a timeline frame and reports color scopes (luma/RGB levels, saturation, warm/cool + green/magenta bias, histograms). Optionally compares to a reference frame with actionable gap hints.",
    inputSchema: z.object({
      clipId: z.string().optional(),
      atFrame: z.number().int().optional(),
      referenceFrame: z.number().int().optional(),
    }),
    async run(args, ctx) {
      const a = args as { clipId?: string; atFrame?: number; referenceFrame?: number };
      if (!ctx.renderFrame) return errorResult("frame rendering is not available in this context");
      const tl = ctx.store.getSnapshot().timeline;
      let frame = a.atFrame;
      if (frame === undefined && a.clipId) {
        const loc = findClip(tl, a.clipId);
        if (!loc) return errorResult(`unknown clip: ${a.clipId}`);
        const clip = tl.tracks[loc.trackIndex]!.clips[loc.clipIndex]!;
        frame = clip.startFrame + Math.floor(clip.durationFrames / 2);
      }
      frame = frame ?? tl.tracks.flatMap((t) => t.clips).reduce((m, c) => Math.max(m, c.startFrame), 0);
      const subject = await ctx.renderFrame(frame);
      const scopes = computeScopes(subject.rgba, subject.width, subject.height);
      const payload: Record<string, unknown> = { frame, scopes };
      const blocks: ToolBlock[] = [];
      if (subject.jpegBase64) blocks.push({ kind: "image", base64: subject.jpegBase64, mediaType: "image/jpeg" });
      if (a.referenceFrame !== undefined) {
        const ref = await ctx.renderFrame(a.referenceFrame);
        const refScopes = computeScopes(ref.rgba, ref.width, ref.height);
        payload.reference = refScopes;
        payload.gap = scopesGap(scopes, refScopes);
        if (ref.jpegBase64) blocks.push({ kind: "image", base64: ref.jpegBase64, mediaType: "image/jpeg" });
      }
      blocks.push({ kind: "text", text: JSON.stringify(payload, null, 2) });
      return { blocks, isError: false };
    },
  };
}

export function applyEffectTool(): ToolSpec {
  return {
    name: "apply_effect",
    description:
      "Adds/updates or removes non-color effects (blur, chroma key, vignette, grain, glow, etc.) on clips. Rejects color.* — use apply_color. One undo step.",
    inputSchema: z.object({
      clipIds: z.array(z.string()).min(1),
      effects: z
        .array(
          z.object({
            type: z.string(),
            params: z.record(z.string(), z.number()).optional(),
            enabled: z.boolean().optional(),
          }),
        )
        .optional(),
      remove: z.array(z.string()).optional(),
    }),
    run(args, ctx) {
      const a = args as {
        clipIds: string[];
        effects?: { type: string; params?: Record<string, number>; enabled?: boolean }[];
        remove?: string[];
      };
      const adds = a.effects ?? [];
      for (const e of adds) {
        if (e.type.startsWith("color.")) {
          return errorResult(`'${e.type}' is a color effect — use apply_color instead`);
        }
        if (!effectDescriptor(e.type)) {
          return errorResult(`unknown effect type: '${e.type}'`);
        }
      }
      const tl = ctx.store.getSnapshot().timeline;
      for (const id of a.clipIds) {
        if (!findClip(tl, id)) return errorResult(`unknown clip: ${id}`);
      }
      const reducer = (t: Timeline): Timeline => ({
        ...t,
        tracks: t.tracks.map((tr) => ({
          ...tr,
          clips: tr.clips.map((c) =>
            a.clipIds.includes(c.id)
              ? { ...c, effects: withStack(applyEffectStack(c.effects, adds, a.remove ?? [], ctx.newId)) }
              : c,
          ),
        })),
      });
      asUndoStep(ctx.store, "Apply Effect (Agent)", [reducer]);
      return ok(`Updated effects on ${a.clipIds.length} clip(s).`);
    },
  };
}
