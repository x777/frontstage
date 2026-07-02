import { z } from "zod";

const uuid = () => crypto.randomUUID();

export const ClipTypeSchema = z.enum(["video", "audio", "image", "text", "lottie"]);
export const InterpolationSchema = z.enum(["linear", "hold", "smooth"]);
export const FadeInterpolationSchema = z.enum(["linear", "smooth"]);

export const RGBASchema = z.object({
  r: z.number().default(1),
  g: z.number().default(1),
  b: z.number().default(1),
  a: z.number().default(1),
});

export const TransformSchema = z.preprocess(
  (raw) => {
    if (raw && typeof raw === "object" && !("centerX" in raw) && ("x" in raw || "y" in raw)) {
      const r = raw as Record<string, number>;
      const width = r.width ?? 1;
      const height = r.height ?? 1;
      return {
        ...r,
        width,
        height,
        centerX: (r.x ?? 0) + width - 0.5,
        centerY: (r.y ?? 0) + height - 0.5,
      };
    }
    return raw;
  },
  z.object({
    centerX: z.number().default(0.5),
    centerY: z.number().default(0.5),
    width: z.number().default(1),
    height: z.number().default(1),
    rotation: z.number().default(0),
    flipHorizontal: z.boolean().default(false),
    flipVertical: z.boolean().default(false),
  }),
);

export const CropSchema = z.object({
  left: z.number().default(0),
  top: z.number().default(0),
  right: z.number().default(0),
  bottom: z.number().default(0),
});

const keyframe = <T extends z.ZodTypeAny>(value: T) =>
  z.object({ frame: z.number().int(), value, interpolationOut: InterpolationSchema.default("smooth") });
const track = <T extends z.ZodTypeAny>(value: T) =>
  z.object({ keyframes: z.array(keyframe(value)).default([]) });

const AnimPairSchema = z.object({ a: z.number(), b: z.number() });
export const KeyframeNumberTrackSchema = track(z.number());
export const KeyframeAnimPairTrackSchema = track(AnimPairSchema);
export const KeyframeCropTrackSchema = track(CropSchema);

export const ShadowSchema = z.object({
  enabled: z.boolean().default(true),
  color: RGBASchema.default({ r: 0, g: 0, b: 0, a: 0.6 }),
  offsetX: z.number().default(0),
  offsetY: z.number().default(-2),
  blur: z.number().default(6),
});
export const FillSchema = z.object({
  enabled: z.boolean().default(false),
  color: RGBASchema.default({ r: 0, g: 0, b: 0, a: 1 }),
});
export const TextStyleSchema = z.object({
  fontName: z.string().default("Helvetica-Bold"),
  fontSize: z.number().default(96),
  fontScale: z.number().default(1),
  color: RGBASchema.default({ r: 1, g: 1, b: 1, a: 1 }),
  alignment: z.enum(["left", "center", "right"]).default("center"),
  shadow: ShadowSchema.default({}),
  background: FillSchema.default({ enabled: false, color: { r: 0, g: 0, b: 0, a: 0.6 } }),
  border: FillSchema.default({ enabled: false, color: { r: 0, g: 0, b: 0, a: 1 } }),
});

export const MediaSourceSchema = z.union([
  z.object({ kind: z.literal("external"), absolutePath: z.string() }),
  z.object({ kind: z.literal("project"), relativePath: z.string() }),
]);

export const GenerationInputSchema = z.object({
  prompt: z.string(),
  model: z.string(),
  duration: z.number(),
  aspectRatio: z.string(),
  resolution: z.string().optional(),
  quality: z.string().optional(),
  imageURLs: z.array(z.string()).optional(),
  numImages: z.number().optional(),
  voice: z.string().optional(),
  lyrics: z.string().optional(),
  styleInstructions: z.string().optional(),
  instrumental: z.boolean().optional(),
  generateAudio: z.boolean().optional(),
  referenceImageURLs: z.array(z.string()).optional(),
  referenceVideoURLs: z.array(z.string()).optional(),
  referenceAudioURLs: z.array(z.string()).optional(),
  imageURLAssetIds: z.array(z.string()).optional(),
  referenceImageAssetIds: z.array(z.string()).optional(),
  referenceVideoAssetIds: z.array(z.string()).optional(),
  referenceAudioAssetIds: z.array(z.string()).optional(),
  createdAt: z.string().optional(),
  backendJobId: z.string().optional(),
  outputIndex: z.number().optional(),
  resultURLs: z.array(z.string()).optional(),
});

export const MediaManifestEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: ClipTypeSchema,
  source: MediaSourceSchema,
  duration: z.number(),
  generationInput: GenerationInputSchema.optional(),
  sourceWidth: z.number().optional(),
  sourceHeight: z.number().optional(),
  sourceFPS: z.number().optional(),
  hasAudio: z.boolean().optional(),
  folderId: z.string().optional(),
  cachedRemoteURL: z.string().optional(),
  cachedRemoteURLExpiresAt: z.string().optional(),
  generationStatus: z.string().optional(),
  transcriptPath: z.string().optional(),
});

export const MediaFolderSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentFolderId: z.string().optional(),
});

export const MediaManifestSchema = z.object({
  version: z.number().default(2),
  entries: z.array(MediaManifestEntrySchema).default([]),
  folders: z.array(MediaFolderSchema).default([]),
});

export const GenerationLogEntrySchema = z.object({
  id: z.string().default(uuid),
  model: z.string(),
  costCredits: z.number().nullable().default(null),
  createdAt: z.string().nullable().default(null),
});
export const GenerationLogSchema = z.object({
  version: z.number().default(1),
  entries: z.array(GenerationLogEntrySchema).default([]),
});

export const BlendModeSchema = z.enum([
  "normal", "darken", "multiply", "colorBurn", "lighten", "screen", "colorDodge",
  "overlay", "softLight", "hardLight", "difference", "exclusion",
  "hue", "saturation", "color", "luminosity",
]);

export const EffectParamSchema = z.object({
  value: z.number().optional(),
  string: z.string().optional(),
  track: KeyframeNumberTrackSchema.optional(),
});

export const EffectSchema = z.object({
  id: z.string(),
  type: z.string(),
  enabled: z.boolean(),
  params: z.record(EffectParamSchema),
});

export const ClipSchema = z.object({
  id: z.string().default(uuid),
  mediaRef: z.string(),
  mediaType: ClipTypeSchema.default("video"),
  sourceClipType: ClipTypeSchema.default("video"),
  startFrame: z.number().int(),
  durationFrames: z.number().int(),
  trimStartFrame: z.number().int().default(0),
  trimEndFrame: z.number().int().default(0),
  speed: z.number().default(1),
  volume: z.number().default(1),
  fadeInFrames: z.number().int().default(0),
  fadeOutFrames: z.number().int().default(0),
  fadeInInterpolation: FadeInterpolationSchema.default("linear"),
  fadeOutInterpolation: FadeInterpolationSchema.default("linear"),
  opacity: z.number().default(1),
  transform: TransformSchema.default({}),
  crop: CropSchema.default({}),
  linkGroupId: z.string().optional(),
  captionGroupId: z.string().optional(),
  textContent: z.string().optional(),
  textStyle: TextStyleSchema.optional(),
  effects: z.array(EffectSchema).optional(),
  blendMode: BlendModeSchema.optional(),
  opacityTrack: KeyframeNumberTrackSchema.optional(),
  positionTrack: KeyframeAnimPairTrackSchema.optional(),
  scaleTrack: KeyframeAnimPairTrackSchema.optional(),
  rotationTrack: KeyframeNumberTrackSchema.optional(),
  cropTrack: KeyframeCropTrackSchema.optional(),
  volumeTrack: KeyframeNumberTrackSchema.optional(),
});

export const TrackSchema = z.object({
  id: z.string().default(uuid),
  type: ClipTypeSchema,
  muted: z.boolean().default(false),
  hidden: z.boolean().default(false),
  syncLocked: z.boolean().default(true),
  displayHeight: z.number().optional(),
  clips: z.array(ClipSchema).default([]),
});

export const TimelineSchema = z.object({
  fps: z.number().int().default(30),
  width: z.number().int().default(1920),
  height: z.number().int().default(1080),
  settingsConfigured: z.boolean().default(false),
  tracks: z.array(TrackSchema).default([]),
});
