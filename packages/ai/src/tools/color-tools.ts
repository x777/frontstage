import { z } from "zod";
import {
  findClip,
  buildColorStack,
  applyEffectStack,
  type ApplyColorInput,
  type Effect,
  type Timeline,
} from "@palmier/core";
import type { ToolSpec } from "./types.js";
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
