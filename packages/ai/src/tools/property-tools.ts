import { z } from "zod";
import {
  findClip,
  setClipPropertyCommand,
  setClipTransformCommand,
  setClipCropCommand,
  setClipTextStyleCommand,
  setKeyframeCommand,
  removeKeyframeCommand,
  addClipCommand,
  clipTypesCompatible,
  type KeyframeTrackKey,
} from "@palmier/core";
import type { ToolSpec } from "./types.js";
import { ok, errorResult, asUndoStep } from "./executor.js";

const RGBASchema = z.object({ r: z.number(), g: z.number(), b: z.number(), a: z.number() });
const FillSchema = z.object({ enabled: z.boolean(), color: RGBASchema });
const ShadowSchema = z.object({
  enabled: z.boolean(),
  color: RGBASchema,
  offsetX: z.number(),
  offsetY: z.number(),
  blur: z.number(),
});

const TextStyleSchema = z.object({
  fontName: z.string(),
  fontSize: z.number(),
  fontScale: z.number(),
  color: RGBASchema,
  alignment: z.enum(["left", "center", "right"]),
  shadow: ShadowSchema,
  background: FillSchema,
  border: FillSchema,
});

const TransformSchema = z.object({
  centerX: z.number(),
  centerY: z.number(),
  width: z.number(),
  height: z.number(),
  rotation: z.number(),
  flipHorizontal: z.boolean(),
  flipVertical: z.boolean(),
});

const CropSchema = z.object({
  top: z.number(),
  bottom: z.number(),
  left: z.number(),
  right: z.number(),
});

const AnimPairSchema = z.object({ a: z.number(), b: z.number() });

const KEYFRAME_TRACK_KEYS = ["opacityTrack", "positionTrack", "scaleTrack", "rotationTrack", "cropTrack", "volumeTrack"] as const;

export function setClipPropertiesTool(): ToolSpec {
  return {
    name: "set_clip_properties",
    description: "Sets one or more properties on a clip (opacity, volume, speed, transform, crop, textStyle). All property updates are a single undo step.",
    inputSchema: z.object({
      clipId: z.string(),
      properties: z.object({
        opacity: z.number().optional(),
        volume: z.number().optional(),
        speed: z.number().optional(),
        transform: TransformSchema.optional(),
        crop: CropSchema.optional(),
        textStyle: TextStyleSchema.optional(),
      }),
    }),
    run(args, ctx) {
      const { clipId, properties } = args as {
        clipId: string;
        properties: {
          opacity?: number;
          volume?: number;
          speed?: number;
          transform?: z.infer<typeof TransformSchema>;
          crop?: z.infer<typeof CropSchema>;
          textStyle?: z.infer<typeof TextStyleSchema>;
        };
      };
      const tl = ctx.store.getSnapshot().timeline;
      if (!findClip(tl, clipId)) return errorResult(`unknown clip: ${clipId}`);

      const reducers: ((t: ReturnType<typeof ctx.store.getSnapshot>["timeline"]) => ReturnType<typeof ctx.store.getSnapshot>["timeline"])[] = [];

      if (properties.opacity !== undefined) {
        const cmd = setClipPropertyCommand(clipId, "opacity", properties.opacity);
        reducers.push(cmd.apply.bind(cmd));
      }
      if (properties.volume !== undefined) {
        const cmd = setClipPropertyCommand(clipId, "volume", properties.volume);
        reducers.push(cmd.apply.bind(cmd));
      }
      if (properties.speed !== undefined) {
        const cmd = setClipPropertyCommand(clipId, "speed", properties.speed);
        reducers.push(cmd.apply.bind(cmd));
      }
      if (properties.transform !== undefined) {
        const cmd = setClipTransformCommand(clipId, properties.transform);
        reducers.push(cmd.apply.bind(cmd));
      }
      if (properties.crop !== undefined) {
        const cmd = setClipCropCommand(clipId, properties.crop);
        reducers.push(cmd.apply.bind(cmd));
      }
      if (properties.textStyle !== undefined) {
        const cmd = setClipTextStyleCommand(clipId, properties.textStyle);
        reducers.push(cmd.apply.bind(cmd));
      }

      if (reducers.length === 0) return ok("No properties changed.");

      asUndoStep(ctx.store, "Set Clip Properties", reducers);
      return ok(`Updated ${reducers.length} property(ies) on clip ${clipId}.`);
    },
  };
}

const KeyframeValueSchema = z.union([
  z.number(),
  AnimPairSchema,
  CropSchema,
]);

type KeyframeValueInput = z.infer<typeof KeyframeValueSchema>;

function validateKeyframeValue(trackKey: KeyframeTrackKey, value: KeyframeValueInput): string | null {
  const isNumber = typeof value === "number";
  const isAnimPair = typeof value === "object" && value !== null && "a" in value && "b" in value &&
    !("left" in value) && !("top" in value);
  const isCrop = typeof value === "object" && value !== null && "left" in value && "top" in value &&
    "right" in value && "bottom" in value;

  switch (trackKey) {
    case "opacityTrack":
    case "rotationTrack":
    case "volumeTrack":
      if (!isNumber) return `trackKey "${trackKey}" requires a number value`;
      break;
    case "positionTrack":
    case "scaleTrack":
      if (!isAnimPair) return `trackKey "${trackKey}" requires an {a, b} AnimPair value`;
      break;
    case "cropTrack":
      if (!isCrop) return `trackKey "${trackKey}" requires a {left, top, right, bottom} Crop value`;
      break;
  }
  return null;
}

export function setKeyframesTool(): ToolSpec {
  return {
    name: "set_keyframes",
    description: "Sets or removes keyframes on a clip's animation track. All keyframe changes are a single undo step.",
    inputSchema: z.object({
      clipId: z.string(),
      trackKey: z.enum(KEYFRAME_TRACK_KEYS),
      keyframes: z.array(z.object({
        frame: z.number().int(),
        value: KeyframeValueSchema.optional(),
        interpolationOut: z.enum(["linear", "smooth"]).optional(),
        remove: z.boolean().optional(),
      })).min(1),
    }),
    run(args, ctx) {
      const { clipId, trackKey, keyframes } = args as {
        clipId: string;
        trackKey: KeyframeTrackKey;
        keyframes: { frame: number; value?: KeyframeValueInput; interpolationOut?: "linear" | "smooth"; remove?: boolean }[];
      };
      const tl = ctx.store.getSnapshot().timeline;
      if (!findClip(tl, clipId)) return errorResult(`unknown clip: ${clipId}`);

      // Validate all non-remove keyframe values before touching the store
      for (const kf of keyframes) {
        if (!kf.remove) {
          if (kf.value === undefined) return errorResult(`keyframe at frame ${kf.frame} missing value`);
          const err = validateKeyframeValue(trackKey, kf.value);
          if (err) return errorResult(err);
        }
      }

      const reducers = keyframes.map((kf) => {
        if (kf.remove) {
          const cmd = removeKeyframeCommand(clipId, trackKey, kf.frame);
          return cmd.apply.bind(cmd);
        }
        const cmd = setKeyframeCommand(clipId, trackKey, kf.frame, kf.value as never, kf.interpolationOut ?? "linear");
        return cmd.apply.bind(cmd);
      });

      asUndoStep(ctx.store, "Set Keyframes", reducers);
      return ok(`Set ${keyframes.length} keyframe(s) on ${trackKey} of clip ${clipId}.`);
    },
  };
}

export function addTextsTool(): ToolSpec {
  return {
    name: "add_texts",
    description: "Adds one or more text clips to the timeline. All additions are a single undo step.",
    inputSchema: z.object({
      texts: z.array(z.object({
        content: z.string(),
        startFrame: z.number().int(),
        durationFrames: z.number().int().optional(),
        trackIndex: z.number().int().optional(),
        style: TextStyleSchema.optional(),
      })).min(1),
    }),
    run(args, ctx) {
      const { texts } = args as {
        texts: {
          content: string;
          startFrame: number;
          durationFrames?: number;
          trackIndex?: number;
          style?: z.infer<typeof TextStyleSchema>;
        }[];
      };
      const tl = ctx.store.getSnapshot().timeline;
      const fps = tl.fps;

      // Validate all targets before touching the store
      for (const text of texts) {
        if (text.trackIndex !== undefined) {
          if (text.trackIndex < 0 || text.trackIndex >= tl.tracks.length)
            return errorResult(`trackIndex ${text.trackIndex} out of range`);
          const track = tl.tracks[text.trackIndex]!;
          if (!clipTypesCompatible(track.type, "text"))
            return errorResult(`track type "${track.type}" at index ${text.trackIndex} is incompatible with text clips`);
        }
      }

      // Build a synthetic text MediaManifestEntry per text and collect command reducers
      const reducers: ((t: ReturnType<typeof ctx.store.getSnapshot>["timeline"]) => ReturnType<typeof ctx.store.getSnapshot>["timeline"])[] = [];
      const ids: string[] = [];

      for (const text of texts) {
        const clipId = ctx.newId();
        ids.push(clipId);
        const durationSecs = text.durationFrames !== undefined ? text.durationFrames / fps : 5;

        const entry = {
          id: ctx.newId(),
          name: text.content.slice(0, 32),
          type: "text" as const,
          source: { kind: "project" as const, relativePath: "" },
          duration: durationSecs,
        };

        const target =
          text.trackIndex !== undefined
            ? { kind: "existing" as const, index: text.trackIndex }
            : { kind: "new" as const, index: 0 };

        const addCmd = addClipCommand(entry, target, text.startFrame, fps, undefined, () => clipId);
        reducers.push(addCmd.apply.bind(addCmd));

        const contentCmd = setClipPropertyCommand(clipId, "textContent", text.content);
        reducers.push(contentCmd.apply.bind(contentCmd));

        if (text.style) {
          const styleCmd = setClipTextStyleCommand(clipId, text.style);
          reducers.push(styleCmd.apply.bind(styleCmd));
        }
      }

      asUndoStep(ctx.store, "Add Texts", reducers);
      return ok(`Added ${texts.length} text clip(s): ${ids.join(", ")}`);
    },
  };
}
