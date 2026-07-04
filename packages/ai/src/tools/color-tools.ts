import { z } from "zod";
import {
  findClip,
  buildColorStack,
  applyEffectStack,
  computeScopes,
  scopesGap,
  effectDescriptor,
  parseCubeLUT,
  type ApplyColorInput,
  type Effect,
  type Timeline,
} from "@palmier/core";
import type { ToolBlock, ToolSpec } from "./types.js";
import { ok, errorResult, asUndoStep } from "./executor.js";

const numPair = z.array(z.tuple([z.number(), z.number()]));

const withStack = (s: Effect[]): Effect[] | undefined => (s.length ? s : undefined);

function basename(path: string): string {
  return path.split(/[/\\]/).pop() || path;
}

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
    async run(args, ctx) {
      const input = args as ApplyColorInput;
      const tl = ctx.store.getSnapshot().timeline;
      for (const id of input.clipIds) {
        if (!findClip(tl, id)) return errorResult(`unknown clip: ${id}`);
      }

      // .cube persistence (M14C T2, the Swift LUTLoader.store pattern): the raw path is a local
      // file path the agent was given — read it, validate it, copy it into the project (luts/<name>,
      // unique-suffix on collision), and reference the STORED project-relative path from here on.
      // A path already under luts/ is already the stored, project-relative path (re-apply / edit-
      // intensity flows re-pass it unchanged) — reference it as-is, mirroring Swift LUTLoader.store's
      // same-path short-circuit, instead of re-reading/re-storing it (which ENOENTs on desktop since
      // it's not an absolute path, or mints a duplicate luts/<name> copy).
      let effectiveInput = input;
      if (input.lut?.path && !input.lut.path.startsWith("luts/")) {
        if (!ctx.lut) return errorResult("apply_color: LUT storage is not available in this context");
        if (!ctx.lut.readLocalFile) {
          return errorResult("apply_color: reading a local .cube path is not available on web");
        }
        let bytes: Uint8Array;
        try {
          bytes = await ctx.lut.readLocalFile(input.lut.path);
        } catch {
          return errorResult(`No file at path: ${input.lut.path}`);
        }
        const cube = parseCubeLUT(new TextDecoder().decode(bytes));
        if (!cube) return errorResult(`Not a valid .cube 3D LUT: ${basename(input.lut.path)}`);
        const relativePath = await ctx.lut.store(basename(input.lut.path), bytes);
        effectiveInput = { ...input, lut: { ...input.lut, path: relativePath } };
      }

      const reducer = (t: Timeline): Timeline => ({
        ...t,
        tracks: t.tracks.map((tr) => ({
          ...tr,
          clips: tr.clips.map((c) =>
            effectiveInput.clipIds.includes(c.id)
              ? { ...c, effects: withStack(buildColorStack(c.effects, effectiveInput, ctx.newId)) }
              : c,
          ),
        })),
      });
      asUndoStep(ctx.store, "Color Grade (Agent)", [reducer]);
      return ok(`Applied color grade to ${effectiveInput.clipIds.length} clip(s).`);
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
