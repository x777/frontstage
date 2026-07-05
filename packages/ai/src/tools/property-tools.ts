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
  TEXT_ANIMATION_PRESETS,
  type KeyframeTrackKey,
} from "@palmier/core";
import type { ToolSpec } from "./types.js";
import { ok, errorResult, asUndoStep } from "./executor.js";

const RGBASchema = z.object({ r: z.number().finite(), g: z.number().finite(), b: z.number().finite(), a: z.number().finite() });
const FillSchema = z.object({ enabled: z.boolean(), color: RGBASchema });
const ShadowSchema = z.object({
  enabled: z.boolean(),
  color: RGBASchema,
  offsetX: z.number().finite(),
  offsetY: z.number().finite(),
  blur: z.number().finite(),
});

const TextStyleSchema = z.object({
  fontName: z.string(),
  fontSize: z.number().finite(),
  fontScale: z.number().finite(),
  color: RGBASchema,
  alignment: z.enum(["left", "center", "right"]),
  shadow: ShadowSchema,
  background: FillSchema,
  border: FillSchema,
});

const TransformSchema = z.object({
  centerX: z.number().finite(),
  centerY: z.number().finite(),
  width: z.number().finite(),
  height: z.number().finite(),
  rotation: z.number().finite(),
  flipHorizontal: z.boolean(),
  flipVertical: z.boolean(),
});

const CropSchema = z.object({
  top: z.number().finite(),
  bottom: z.number().finite(),
  left: z.number().finite(),
  right: z.number().finite(),
});

const AnimPairSchema = z.object({ a: z.number().finite(), b: z.number().finite() });

const TextAnimationSchema = z.object({
  preset: z.enum(TEXT_ANIMATION_PRESETS),
  highlightColor: RGBASchema.optional(),
});

const KEYFRAME_TRACK_KEYS = ["opacityTrack", "positionTrack", "scaleTrack", "rotationTrack", "cropTrack", "volumeTrack"] as const;

export function setClipPropertiesTool(): ToolSpec {
  return {
    name: "set_clip_properties",
    description: "Sets one or more properties on a clip (opacity, volume, speed, transform, crop, textStyle). All property updates are a single undo step.",
    inputSchema: z.object({
      clipId: z.string(),
      properties: z.object({
        opacity: z.number().finite().min(0).max(1).optional(),
        volume: z.number().finite().min(0).max(8).optional(),
        speed: z.number().finite().min(0.05).max(100).optional(),
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
      const loc = findClip(tl, clipId);
      if (!loc) return errorResult(`unknown clip: ${clipId}`);
      const clip = tl.tracks[loc.trackIndex]!.clips[loc.clipIndex]!;

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

      const kf = (t?: { keyframes: unknown[] }) => !!t && t.keyframes.length > 0;
      const notes: string[] = [];
      if (properties.opacity !== undefined && kf(clip.opacityTrack)) notes.push("opacity is keyframed — the base value has no visual effect; use set_keyframes");
      if (properties.volume !== undefined && kf(clip.volumeTrack)) notes.push("volume is keyframed — use set_keyframes");
      if (properties.transform !== undefined && (kf(clip.positionTrack) || kf(clip.scaleTrack) || kf(clip.rotationTrack))) notes.push("transform is keyframed — use set_keyframes");
      if (properties.crop !== undefined && kf(clip.cropTrack)) notes.push("crop is keyframed — use set_keyframes");

      asUndoStep(ctx.store, "Set Clip Properties", reducers);
      return ok(`Updated ${reducers.length} property(ies) on clip ${clipId}.${notes.length ? " Note: " + notes.join("; ") + "." : ""}`);
    },
  };
}

const KeyframeValueSchema = z.union([
  z.number().finite(),
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
        frame: z.number().finite().int(),
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

      const removedCount = keyframes.filter((k) => k.remove).length;
      const setCount = keyframes.length - removedCount;
      asUndoStep(ctx.store, "Set Keyframes", reducers);
      const parts = [setCount ? `set ${setCount}` : "", removedCount ? `removed ${removedCount}` : ""].filter(Boolean);
      return ok(`Keyframes on ${trackKey} of clip ${clipId}: ${parts.join(", ")}.`);
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
        startFrame: z.number().finite().int(),
        durationFrames: z.number().finite().int().optional(),
        trackIndex: z.number().finite().int().optional(),
        style: TextStyleSchema.optional(),
        animation: TextAnimationSchema.optional(),
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
          animation?: z.infer<typeof TextAnimationSchema>;
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

        // addClipCommand mints one id PER ENTITY — clip, then a new track for {kind:"new"}
        // targets. A constant thunk collides the track id with the clip id (Bug-#1 class);
        // only the first call may return clipId, later calls mint fresh.
        reducers.push((t: ReturnType<typeof ctx.store.getSnapshot>["timeline"]) => {
          let clipIdConsumed = false;
          const perEntityNewId = (): string => {
            if (!clipIdConsumed) {
              clipIdConsumed = true;
              return clipId;
            }
            return ctx.newId();
          };
          return addClipCommand(entry, target, text.startFrame, fps, undefined, perEntityNewId).apply(t);
        });

        const contentCmd = setClipPropertyCommand(clipId, "textContent", text.content);
        reducers.push(contentCmd.apply.bind(contentCmd));

        if (text.style) {
          const styleCmd = setClipTextStyleCommand(clipId, text.style);
          reducers.push(styleCmd.apply.bind(styleCmd));
        }

        // wordTimings is intentionally left unset here — a per-word preset with no wordTimings
        // falls back to its static (all-visible) rendering, per T2.
        if (text.animation) {
          const animCmd = setClipPropertyCommand(clipId, "textAnimation", text.animation);
          reducers.push(animCmd.apply.bind(animCmd));
        }
      }

      asUndoStep(ctx.store, "Add Texts", reducers);
      return ok(`Added ${texts.length} text clip(s): ${ids.join(", ")}`);
    },
  };
}
