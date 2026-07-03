import { type XmlNode, renderXml } from "./xml.js";
import { type SourceTimecode, timecodeFrames, roundHalfAwayFromZero } from "./source-timecode.js";
import { lastPathComponent, resolveFileUrl } from "./media-resources.js";
import { type Timeline, timelineTotalFrames } from "../timeline.js";
import {
  type Clip,
  sourceDurationFrames as clipSourceDurationFrames,
  rawOpacityAt,
  sizeAt,
  rotationAt,
  transformAt,
} from "../clip.js";
import { clipTypeIsVisual } from "../clip-type.js";
import { type Transform, cropIsIdentity } from "../transform.js";
import type { KeyframeTrack } from "../keyframe.js";
import { type TextStyle, type RGBA, defaultTextStyle, GLYPH_BORDER_STROKE_WIDTH } from "../text-style.js";
import type { MediaManifestEntry } from "../media.js";
import { secondsToFrame } from "../time.js";

/**
 * Exports a Timeline as FCPXML (DaVinci Resolve / Final Cut Pro). Faithful port of Swift's
 * `FCPXMLExporter` (`Export/FCPXMLExporter.swift`) — read that file (and the #247/#254 diffs,
 * commits 6b9ef98/81bc201) before touching this one.
 *
 * Encoding facts (reverse-engineered from Resolve round-trips, ported verbatim):
 * - Position: unit = 1% of frame height, square, origin at center, +Y up; for `target: "resolve"`,
 *   pre-divided by the clip's per-axis conform-fit fraction (Resolve scales imported positions by
 *   it at render). `target: "fcp"` writes the spec-literal value (fit 1×1).
 * - Scale: multiplier on the conform-fit size (aspect-fit divided out of width/height) —
 *   unconditional, regardless of target.
 * - Rotation: degrees, negated (FCP is counter-clockwise-positive). Flip: negative scale.
 * - Crop: `<trim-rect>`; for `target: "resolve"` in Resolve's mixed units (left/right: source px ÷
 *   (seqHeight/100); top/bottom: crop fraction ÷ conform-fit scale), for `target: "fcp"` (or
 *   unknown source dims) plain percentages of the source per edge.
 * - Clips are flat `<asset-clip>`s (stills: `<video>`) carrying timeMap/crop/transform/blend
 *   directly; only an A/V source played one-sided (srcEnable) rides a compound `<media>`/
 *   `<ref-clip>` — Resolve honors `srcEnable` only on ref-clips. A compound resource is only
 *   emitted when a ref-clip actually references it (`markUsedCompounds`).
 * - Retime: a `<timeMap>` on the clip ramps the whole media (output[0, media/speed] → source[0,
 *   media]) and `start` windows in along the output axis (= source in-point ÷ speed).
 * - Keyframes: child `<param>/<keyframeAnimation>`; `time` is offset by `start` (the output axis).
 *   Volume: `<adjust-volume amount>` in dB, static only.
 * - Clip adjustment child order is DTD-fixed: timeMap, crop, conform, transform, blend, volume
 *   (Final Cut validates strictly).
 * - `<media-rep src>` percent-encodes `'!$&()*+,;=` — the sub-delims Foundation/encodeURIComponent
 *   leave literal, which XML-escapes to `&apos;` etc. and breaks Resolve's relinker.
 *
 * #247 axis rule: `<asset>` and the compound's INNER clip declare `start=<embedded tc>`; the
 * compound spine and the outer `<ref-clip>`/direct flat clip (when there's no compound) stay
 * 0-based, EXCEPT the no-compound flat clip case, which has no inner layer to absorb the origin
 * and so folds it into its own `start`/`timeMap` directly (`clipStart`/`timeMapNode`'s `origin`
 * param — 0 for the compound path, `resource.startTimecodeFrames` otherwise).
 *
 * What transports: clip placement/trims, speed, lane order, enabled state; text + font/size/
 * color/alignment/stroke (face is always "Regular" — no CoreText off-macOS, a documented
 * deviation); position/scale/rotation/flip (+ position/scale/rotation keyframes); crop; opacity
 * (+ keyframes); static volume; source start timecode.
 *
 * What does NOT: keyframed audio volume, audio fades, text background boxes, crop keyframes,
 * title rotation/scale, color & effects, Lottie clips.
 */
export type FcpxmlVersion = "1.10" | "1.11" | "1.12" | "1.13" | "1.14";

/** Resolve interprets several FCPXML values off-spec (trim-rect units, imported position scaled by
 * the conform fit at render); Final Cut is spec-literal. Same structure, different value encoding. */
export type FcpxmlTarget = "resolve" | "fcp";

const DEFAULT_VERSION: FcpxmlVersion = "1.10";
const DEFAULT_TARGET: FcpxmlTarget = "resolve";
const SEQUENCE_FORMAT_ID = "r1";
const TITLE_EFFECT_ID = "titleBasic";

export function exportFcpxml(
  timeline: Timeline,
  entries: MediaManifestEntry[],
  opts: {
    projectRoot?: string;
    projectName: string;
    startTimecodes: Map<string, SourceTimecode>;
    version?: FcpxmlVersion;
    target?: FcpxmlTarget;
  },
): string {
  const fps = Math.max(1, timeline.fps);
  const entriesById = new Map(entries.map((e) => [e.id, e]));

  const clips = emittableClips(timeline, entriesById);
  const { resources, resourceIndex } = collectResources(
    clips,
    entriesById,
    fps,
    opts.startTimecodes,
    opts.projectRoot,
    opts.projectName,
  );
  const { linkedAudioForVideo, redundantAudioClipIds } = indexLinkedPairs(clips);
  const usedCompoundIds = markUsedCompounds(clips, resourceIndex, resources, linkedAudioForVideo, redundantAudioClipIds);
  const hasTitles = clips.some((item) => item.clip.mediaType === "text");

  const ctx: Ctx = {
    timeline,
    fps,
    seqWidth: timeline.width,
    seqHeight: timeline.height,
    target: opts.target ?? DEFAULT_TARGET,
    entriesById,
    resources,
    resourceIndex,
    linkedAudioForVideo,
    redundantAudioClipIds,
    usedCompoundIds,
    nextTextStyleId: { value: 1 },
  };

  const root = el("fcpxml", { version: opts.version ?? DEFAULT_VERSION }, [resourcesNode(ctx, hasTitles), libraryNode(ctx, clips)]);

  return renderXml(root, { declaration: '<?xml version="1.0" encoding="UTF-8"?>', doctype: "<!DOCTYPE fcpxml>" });
}

// MARK: - Context

interface EmittableClip {
  clip: Clip;
  lane: number;
  enabled: boolean;
}

/** One asset per resolved physical source file — merged across mediaRefs, unlike media-resources.ts's per-ref dedupe. */
interface MediaResource {
  assetId: string;
  formatId?: string;
  compoundId?: string;
  entry: MediaManifestEntry;
  fileName: string;
  fileUrl: string;
  durationFrames: number;
  hasVideo: boolean;
  hasAudio: boolean;
  /** Embedded start timecode in timeline-frame units; 0 when absent. */
  startTimecodeFrames: number;
}

interface Ctx {
  timeline: Timeline;
  fps: number;
  seqWidth: number;
  seqHeight: number;
  target: FcpxmlTarget;
  entriesById: Map<string, MediaManifestEntry>;
  resources: MediaResource[];
  resourceIndex: Map<string, number>;
  // A synced A/V pair collapses into one flat asset-clip; the audio partner is dropped, its volume kept.
  linkedAudioForVideo: Map<string, Clip>;
  redundantAudioClipIds: Set<string>;
  // Only referenced compounds (one-sided A/V ref-clips) get a <media> resource emitted.
  usedCompoundIds: Set<string>;
  nextTextStyleId: { value: number };
}

// Video + audio with matching linkGroup, source, timing, and enabled state are a synced pair.
function indexLinkedPairs(clips: EmittableClip[]): {
  linkedAudioForVideo: Map<string, Clip>;
  redundantAudioClipIds: Set<string>;
} {
  const byGroup = new Map<string, { videos: EmittableClip[]; audios: EmittableClip[] }>();
  for (const item of clips) {
    const group = item.clip.linkGroupId;
    if (!group) continue;
    const entry = byGroup.get(group) ?? { videos: [], audios: [] };
    if (item.clip.mediaType === "video" || item.clip.mediaType === "image") entry.videos.push(item);
    else if (item.clip.mediaType === "audio") entry.audios.push(item);
    byGroup.set(group, entry);
  }

  const linkedAudioForVideo = new Map<string, Clip>();
  const redundantAudioClipIds = new Set<string>();
  for (const pair of byGroup.values()) {
    if (pair.videos.length !== 1 || pair.audios.length !== 1) continue;
    const v = pair.videos[0]!;
    const a = pair.audios[0]!;
    if (
      v.clip.mediaRef !== a.clip.mediaRef ||
      v.enabled !== a.enabled ||
      v.clip.startFrame !== a.clip.startFrame ||
      v.clip.durationFrames !== a.clip.durationFrames ||
      v.clip.trimStartFrame !== a.clip.trimStartFrame ||
      Math.abs(v.clip.speed - a.clip.speed) >= 0.0001
    ) {
      continue;
    }
    linkedAudioForVideo.set(v.clip.id, a.clip);
    redundantAudioClipIds.add(a.clip.id);
  }
  return { linkedAudioForVideo, redundantAudioClipIds };
}

// Mirrors assetClipNode's ref-clip condition; only referenced compounds get a <media> resource.
function markUsedCompounds(
  clips: EmittableClip[],
  resourceIndex: Map<string, number>,
  resources: MediaResource[],
  linkedAudioForVideo: Map<string, Clip>,
  redundantAudioClipIds: Set<string>,
): Set<string> {
  const used = new Set<string>();
  for (const item of clips) {
    if (redundantAudioClipIds.has(item.clip.id)) continue;
    const i = resourceIndex.get(item.clip.mediaRef);
    if (i === undefined) continue;
    const compoundId = resources[i]!.compoundId;
    if (!compoundId) continue;
    if (linkedAudioForVideo.has(item.clip.id)) continue;
    used.add(compoundId);
  }
  return used;
}

// MARK: - Resources

function resourcesNode(ctx: Ctx, hasTitles: boolean): XmlNode {
  const children: XmlNode[] = [
    el("format", {
      id: SEQUENCE_FORMAT_ID,
      name: sequenceFormatName(ctx.seqWidth, ctx.seqHeight, ctx.fps),
      frameDuration: frameDuration(ctx.fps),
      width: `${ctx.seqWidth}`,
      height: `${ctx.seqHeight}`,
      colorSpace: "1-1-1 (Rec. 709)",
    }),
  ];

  if (hasTitles) {
    children.push(
      el("effect", {
        id: TITLE_EFFECT_ID,
        name: "Basic Title",
        uid: ".../Titles.localized/Bumper:Opener.localized/Basic Title.localized/Basic Title.moti",
      }),
    );
  }

  for (const r of ctx.resources) {
    const f = formatNode(r, ctx.seqWidth, ctx.seqHeight, ctx.fps);
    if (f) children.push(f);
  }
  for (const r of ctx.resources) children.push(assetNode(r, ctx.fps));
  for (const r of ctx.resources) {
    const c = compoundClipNode(r, ctx.fps, ctx.usedCompoundIds);
    if (c) children.push(c);
  }
  return el("resources", undefined, children);
}

// A compound is only created for an A/V source (hasVideo && hasAudio — see collectResources), so
// its inner clip always carries audio and is always a flat <asset-clip>.
function compoundClipNode(resource: MediaResource, fps: number, usedCompoundIds: Set<string>): XmlNode | undefined {
  if (!resource.compoundId || !usedCompoundIds.has(resource.compoundId)) return undefined;
  const dur = time(resource.durationFrames, fps);
  // The compound spine is 0-based but reads the asset from its own timecode origin, so `start`
  // must equal the asset's embedded start timecode.
  const tcStart = time(resource.startTimecodeFrames, fps);
  const format = resource.formatId ?? SEQUENCE_FORMAT_ID;
  const innerClip = el("asset-clip", { ref: resource.assetId, name: resource.fileName, duration: dur, start: tcStart, offset: "0s", format });
  const sequence = el("sequence", { format, duration: dur, tcStart: "0s", tcFormat: "NDF" }, [el("spine", undefined, [innerClip])]);
  return el("media", { id: resource.compoundId, name: resource.fileName }, [sequence]);
}

function formatNode(resource: MediaResource, seqWidth: number, seqHeight: number, fps: number): XmlNode | undefined {
  if (!resource.formatId) return undefined;
  const width = resource.entry.sourceWidth ?? seqWidth;
  const height = resource.entry.sourceHeight ?? seqHeight;
  const rawFPS = resource.entry.sourceFPS ?? fps;
  return el("format", {
    id: resource.formatId,
    name: videoFormatName(width, height, rawFPS),
    frameDuration: frameDuration(rawFPS),
    width: `${width}`,
    height: `${height}`,
    colorSpace: "1-1-1 (Rec. 709)",
  });
}

function assetNode(resource: MediaResource, fps: number): XmlNode {
  const attrs: Record<string, string> = {
    id: resource.assetId,
    name: resource.fileName,
    start: time(resource.startTimecodeFrames, fps),
    duration: time(resource.durationFrames, fps),
  };
  if (resource.hasVideo) {
    attrs.hasVideo = "1";
    attrs.videoSources = "1";
    if (resource.formatId) attrs.format = resource.formatId;
  }
  if (resource.hasAudio) {
    // We don't probe channels/rate; 2ch/48k is FCP's default and doesn't affect relinking.
    attrs.hasAudio = "1";
    attrs.audioSources = "1";
    attrs.audioChannels = "2";
    attrs.audioRate = "48000";
  }
  return el("asset", attrs, [el("media-rep", { kind: "original-media", src: mediaSrc(resource.fileUrl) })]);
}

// Percent-encode the sub-delims encodeURIComponent leaves literal — Resolve's relinker fails on
// their XML-entity forms (&apos;).
const URL_SUB_DELIMS_TO_ENCODE = "'!$&()*+,;=";
function mediaSrc(fileUrl: string): string {
  let out = "";
  for (const ch of fileUrl) {
    out += URL_SUB_DELIMS_TO_ENCODE.includes(ch) ? `%${ch.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}` : ch;
  }
  return out;
}

/** Walks emittable clips once, grouping by resolved physical file (not mediaRef — several refs can share a file). */
function collectResources(
  clips: EmittableClip[],
  entriesById: Map<string, MediaManifestEntry>,
  fps: number,
  startTimecodes: Map<string, SourceTimecode>,
  projectRoot: string | undefined,
  projectName: string,
): { resources: MediaResource[]; resourceIndex: Map<string, number> } {
  interface Caps {
    mediaRefs: string[];
    hasVideo: boolean;
    hasAudio: boolean;
    duration: number;
    entry: MediaManifestEntry;
    fileName: string;
    fileUrl: string;
  }
  const order: string[] = [];
  const caps = new Map<string, Caps>();

  for (const item of clips) {
    const clip = item.clip;
    if (clip.mediaType === "text" || clip.mediaType === "lottie") continue;
    const entry = entriesById.get(clip.mediaRef);
    if (!entry) continue;

    const path = entry.source.kind === "external" ? entry.source.absolutePath : entry.source.relativePath;
    const fileName = lastPathComponent(path);
    const fileUrl = resolveFileUrl(entry.source, projectRoot, projectName);
    // Physical-path proxy: the resolved file:// URL (no symlink resolution in a pure module).
    const key = fileUrl;
    const duration = sourceDurationFramesFor(entry, clip, fps);
    const isVisual = clip.mediaType !== "audio";
    // Audio clip → audio stream; video clip → audio too if the source file carries it.
    const isAudio = clip.mediaType === "audio" || (clip.mediaType === "video" && entry.hasAudio === true);

    let c = caps.get(key);
    if (!c) {
      c = { mediaRefs: [], hasVideo: false, hasAudio: false, duration: 0, entry, fileName, fileUrl };
      order.push(key);
      caps.set(key, c);
    }
    if (!c.mediaRefs.includes(clip.mediaRef)) c.mediaRefs.push(clip.mediaRef);
    c.hasVideo = c.hasVideo || isVisual;
    c.hasAudio = c.hasAudio || isAudio;
    c.duration = Math.max(c.duration, duration);
  }

  const resources: MediaResource[] = [];
  const resourceIndex = new Map<string, number>();
  for (const key of order) {
    const c = caps.get(key);
    if (!c) continue;
    const id = resources.length + 1;
    for (const ref of c.mediaRefs) resourceIndex.set(ref, resources.length);
    const tcFrames = firstTimecodeFrames(c.mediaRefs, startTimecodes, fps);
    resources.push({
      assetId: `asset${id}`,
      formatId: c.hasVideo ? `r${id + 1}` : undefined,
      // Only an A/V source can need srcEnable gating, so only it gets a compound.
      compoundId: c.hasVideo && c.hasAudio ? `media${id}` : undefined,
      entry: c.entry,
      fileName: c.fileName,
      fileUrl: c.fileUrl,
      durationFrames: c.duration,
      hasVideo: c.hasVideo,
      hasAudio: c.hasAudio,
      startTimecodeFrames: tcFrames,
    });
  }
  return { resources, resourceIndex };
}

function firstTimecodeFrames(mediaRefs: string[], startTimecodes: Map<string, SourceTimecode>, fps: number): number {
  for (const ref of mediaRefs) {
    const tc = startTimecodes.get(ref);
    if (tc) return timecodeFrames(tc, fps);
  }
  return 0;
}

function sourceDurationFramesFor(entry: MediaManifestEntry, clip: Clip, fps: number): number {
  const manifestFrames = Math.max(0, secondsToFrame(entry.duration, fps));
  return Math.max(manifestFrames, clipSourceDurationFrames(clip));
}

// MARK: - Library / project / spine

function libraryNode(ctx: Ctx, clips: EmittableClip[]): XmlNode {
  return el("library", undefined, [el("event", { name: "Palmier Export" }, [projectNode(ctx, clips)])]);
}

function projectNode(ctx: Ctx, clips: EmittableClip[]): XmlNode {
  const totalFrames = timelineTotalFrames(ctx.timeline);
  const duration = time(totalFrames, ctx.fps);
  const spine: XmlNode =
    totalFrames > 0
      ? el("spine", undefined, [el("gap", { name: "Timeline", offset: "0s", start: "0s", duration }, storyNodes(clips, ctx))])
      : el("spine");

  return el("project", { name: "Timeline Export" }, [
    el("sequence", { format: SEQUENCE_FORMAT_ID, duration, tcStart: "0s", tcFormat: "NDF", audioLayout: "stereo", audioRate: "48k" }, [
      spine,
    ]),
  ]);
}

function storyNodes(clips: EmittableClip[], ctx: Ctx): XmlNode[] {
  return clips
    .filter((item) => !ctx.redundantAudioClipIds.has(item.clip.id))
    .sort((a, b) => (a.clip.startFrame !== b.clip.startFrame ? a.clip.startFrame - b.clip.startFrame : a.lane - b.lane))
    .map((item): XmlNode | undefined => {
      switch (item.clip.mediaType) {
        case "text":
          return titleNode(item, ctx);
        case "audio":
        case "video":
        case "image":
          return assetClipNode(item, ctx);
        case "lottie":
          return undefined;
      }
    })
    .filter((n): n is XmlNode => !!n);
}

function assetClipNode(item: EmittableClip, ctx: Ctx): XmlNode | undefined {
  const clip = item.clip;
  const i = ctx.resourceIndex.get(clip.mediaRef);
  if (i === undefined) return undefined;
  const resource = ctx.resources[i]!;
  const linkedAudio = ctx.linkedAudioForVideo.get(clip.id);
  const entry = ctx.entriesById.get(clip.mediaRef);

  // One-sided A/V rides the compound (Resolve honors srcEnable only on ref-clips); everything
  // else — including a linked A/V pair, which plays both streams — exports flat.
  if (resource.compoundId && !linkedAudio) {
    const videoOnly = clip.mediaType !== "audio";
    const attrs: Record<string, string> = {
      ref: resource.compoundId,
      name: resource.fileName,
      lane: `${item.lane}`,
      offset: time(clip.startFrame, ctx.fps),
      start: clipStart(clip, ctx.fps),
      duration: time(clip.durationFrames, ctx.fps),
      enabled: item.enabled ? "1" : "0",
      srcEnable: videoOnly ? "video" : "audio",
    };
    // Child order is DTD-fixed: timeMap, crop, conform, transform, blend, volume.
    const children = videoOnly
      ? [
          timeMapNode(clip, ctx.fps, resource.durationFrames),
          cropNode(clip, ctx.target, entry, ctx.seqWidth, ctx.seqHeight),
          el("adjust-conform", { type: "fit" }),
          transformNode(clip, ctx),
          blendNode(clip, ctx.fps),
        ]
      : [timeMapNode(clip, ctx.fps, resource.durationFrames), volumeNode(clip)];
    return el("ref-clip", attrs, children.filter((n): n is XmlNode => !!n));
  }

  // No compound layer to absorb the origin (audio-only source, or no compound at all) — fold it
  // in directly.
  const origin = resource.startTimecodeFrames;
  const visual = clip.mediaType !== "audio";
  const attrs: Record<string, string> = {
    ref: resource.assetId,
    name: resource.fileName,
    lane: `${item.lane}`,
    offset: time(clip.startFrame, ctx.fps),
    start: clipStart(clip, ctx.fps, origin),
    duration: time(clip.durationFrames, ctx.fps),
    enabled: item.enabled ? "1" : "0",
  };
  const children = [
    timeMapNode(clip, ctx.fps, resource.durationFrames, origin),
    visual ? cropNode(clip, ctx.target, entry, ctx.seqWidth, ctx.seqHeight) : undefined,
    visual ? el("adjust-conform", { type: "fit" }) : undefined,
    visual ? transformNode(clip, ctx) : undefined,
    visual ? blendNode(clip, ctx.fps) : undefined,
    resource.hasAudio ? volumeNode(linkedAudio ?? clip) : undefined,
  ].filter((n): n is XmlNode => !!n);
  // Stills export as <video>, the shape FCP itself writes.
  return el(clip.mediaType === "image" ? "video" : "asset-clip", attrs, children);
}

// MARK: - Titles

function titleNode(item: EmittableClip, ctx: Ctx): XmlNode | undefined {
  const clip = item.clip;
  const content = clip.textContent;
  if (!content) return undefined;
  const style = clip.textStyle ?? defaultTextStyle();
  const styleId = `textStyle${ctx.nextTextStyleId.value}`;
  ctx.nextTextStyleId.value += 1;

  const textNodes: XmlNode[] = [
    el("text", undefined, [el("text-style", { ref: styleId }, [content])]),
    el("text-style-def", { id: styleId }, [el("text-style", textStyleAttributes(style))]),
    ...titleTransformNodes(clip.transform, ctx.seqWidth, ctx.seqHeight),
  ];
  const blend = blendNode(clip, ctx.fps);
  if (blend) textNodes.push(blend);

  return el(
    "title",
    {
      ref: TITLE_EFFECT_ID,
      name: content,
      lane: `${item.lane}`,
      offset: time(clip.startFrame, ctx.fps),
      start: "0s",
      duration: time(clip.durationFrames, ctx.fps),
      enabled: item.enabled ? "1" : "0",
    },
    textNodes,
  );
}

function titleTransformNodes(transform: Transform, seqWidth: number, seqHeight: number): XmlNode[] {
  return [
    el("adjust-conform", { type: "fit" }),
    el("adjust-transform", { scale: "1 1", anchor: "0 0", position: positionValue(transform, seqWidth, seqHeight) }),
  ];
}

// No CoreText off-macOS to resolve family/face from the PostScript font name — the fontName
// passes through as-is and face is always "Regular" (documented deviation from Swift's CoreText path).
function textStyleAttributes(style: TextStyle): Record<string, string> {
  const fontSize = style.fontSize * style.fontScale;
  const attrs: Record<string, string> = {
    font: style.fontName,
    fontFace: "Regular",
    fontSize: formatNumber(fontSize),
    fontColor: colorString(style.color),
    alignment: style.alignment,
  };
  if (style.border.enabled) {
    // GLYPH_BORDER_STROKE_WIDTH is NSAttributedString's percent-of-font-size convention.
    attrs.strokeColor = colorString(style.border.color);
    attrs.strokeWidth = formatNumber((Math.abs(GLYPH_BORDER_STROKE_WIDTH) / 100) * fontSize);
  }
  return attrs;
}

function colorString(color: RGBA): string {
  return `${formatNumber(color.r)} ${formatNumber(color.g)} ${formatNumber(color.b)} ${formatNumber(color.a)}`;
}

// MARK: - Adjustments (blend / transform / crop / volume)

function blendNode(clip: Clip, fps: number): XmlNode | undefined {
  const frames = keyframeFrames(clip, clip.opacityTrack);
  if (!(clip.opacity < 0.9995 || frames.length > 0)) return undefined;
  const children: XmlNode[] = [];
  if (frames.length > 0) {
    children.push(
      keyframeParam("amount", formatNumber(clip.opacity), clip, clip.opacityTrack, frames, fps, (f) => formatNumber(rawOpacityAt(clip, f))),
    );
  }
  return el("adjust-blend", { amount: formatNumber(clip.opacity) }, children);
}

/** Position + scale + rotation (static or keyframed) for a video/image clip. */
function transformNode(clip: Clip, ctx: Ctx): XmlNode | undefined {
  const t = clip.transform;
  const posFrames = keyframeFrames(clip, clip.positionTrack);
  const rotFrames = keyframeFrames(clip, clip.rotationTrack);
  const scaleFrames = keyframeFrames(clip, clip.scaleTrack);
  const entry = ctx.entriesById.get(clip.mediaRef);
  const base = scaleValue(t.width, t.height, clip, entry, ctx.seqWidth, ctx.seqHeight);
  const moved = Math.abs(t.centerX - 0.5) > 0.0005 || Math.abs(t.centerY - 0.5) > 0.0005;
  const rotated = Math.abs(t.rotation) > 0.005;
  const scaled = base !== "1 1";
  if (!(moved || rotated || scaled || posFrames.length > 0 || rotFrames.length > 0 || scaleFrames.length > 0)) return undefined;

  const fit = ctx.target === "resolve" ? fitFractions(entry, ctx.seqWidth, ctx.seqHeight) : { w: 1, h: 1 };
  const attrs: Record<string, string> = { scale: base };
  if (rotated || rotFrames.length > 0) attrs.rotation = formatNumber(-t.rotation);
  attrs.anchor = "0 0";
  attrs.position = positionValue(t, ctx.seqWidth, ctx.seqHeight, fit);

  const params: XmlNode[] = [];
  if (scaleFrames.length > 0) {
    params.push(
      keyframeParam("scale", base, clip, clip.scaleTrack, scaleFrames, ctx.fps, (f) => {
        const s = sizeAt(clip, f);
        return scaleValue(s.width, s.height, clip, entry, ctx.seqWidth, ctx.seqHeight);
      }),
    );
  }
  if (posFrames.length > 0) {
    const base0 = positionValue(t, ctx.seqWidth, ctx.seqHeight, fit);
    params.push(
      keyframeParam("position", base0, clip, clip.positionTrack, posFrames, ctx.fps, (f) =>
        positionValue(transformAt(clip, f), ctx.seqWidth, ctx.seqHeight, fit),
      ),
    );
  }
  if (rotFrames.length > 0) {
    params.push(
      keyframeParam("rotation", formatNumber(-t.rotation), clip, clip.rotationTrack, rotFrames, ctx.fps, (f) =>
        formatNumber(-rotationAt(clip, f)),
      ),
    );
  }
  return el("adjust-transform", attrs, params);
}

/** Divide the aspect-fit out of our frame-fraction width/height so only user scaling remains — unconditional, regardless of target. */
function scaleValue(
  width: number,
  height: number,
  clip: Clip,
  entry: MediaManifestEntry | undefined,
  seqWidth: number,
  seqHeight: number,
): string {
  const fit = fitFractions(entry, seqWidth, seqHeight);
  let sx = width / fit.w;
  let sy = height / fit.h;
  if (clip.transform.flipHorizontal) sx = -sx;
  if (clip.transform.flipVertical) sy = -sy;
  return `${formatNumber(sx)} ${formatNumber(sy)}`;
}

/** Per-axis conform-fit fractions of the sequence frame; 1×1 when source dims are unknown. */
function fitFractions(entry: MediaManifestEntry | undefined, seqWidth: number, seqHeight: number): { w: number; h: number } {
  if (!entry?.sourceWidth || !entry?.sourceHeight || entry.sourceWidth <= 0 || entry.sourceHeight <= 0) return { w: 1, h: 1 };
  const sourceAspect = entry.sourceWidth / entry.sourceHeight;
  const frameAspect = seqWidth / seqHeight;
  return sourceAspect >= frameAspect ? { w: 1, h: frameAspect / sourceAspect } : { w: sourceAspect / frameAspect, h: 1 };
}

function positionValue(transform: Transform, seqWidth: number, seqHeight: number, fit: { w: number; h: number } = { w: 1, h: 1 }): string {
  const unit = seqHeight / 100.0;
  const x = ((transform.centerX - 0.5) * seqWidth) / unit / fit.w;
  const y = ((0.5 - transform.centerY) * seqHeight) / unit / fit.h;
  return `${formatNumber(x)} ${formatNumber(y)}`;
}

/** Resolve's trim-rect units: left/right = source px ÷ (seqHeight/100); top/bottom = crop fraction
 * ÷ conform-fit scale. FCP (and unknown source dims): plain percentages. */
function cropNode(
  clip: Clip,
  target: FcpxmlTarget,
  entry: MediaManifestEntry | undefined,
  seqWidth: number,
  seqHeight: number,
): XmlNode | undefined {
  const c = clip.crop;
  if (cropIsIdentity(c)) return undefined;
  let lr = 100.0;
  let tb = 100.0;
  if (target === "resolve" && entry?.sourceWidth && entry?.sourceHeight && entry.sourceWidth > 0 && entry.sourceHeight > 0) {
    const fit = Math.min(seqWidth / entry.sourceWidth, seqHeight / entry.sourceHeight);
    lr = (entry.sourceWidth * 100.0) / seqHeight;
    tb = 100.0 / fit;
  }
  return el("adjust-crop", { mode: "trim" }, [
    el("trim-rect", {
      top: formatNumber(c.top * tb),
      right: formatNumber(c.right * lr),
      bottom: formatNumber(c.bottom * tb),
      left: formatNumber(c.left * lr),
    }),
  ]);
}

function volumeNode(clip: Clip): XmlNode | undefined {
  // Keyframed audio volume has no FCPXML form Resolve round-trips (its own export drops it),
  // so export the static level only.
  if (Math.abs(clip.volume - 1.0) <= 0.0005) return undefined;
  return el("adjust-volume", { amount: formatNumber(decibels(clip.volume)) });
}

function decibels(linear: number): number {
  return linear > 0 ? 20.0 * Math.log10(linear) : -96.0;
}

// MARK: - Keyframes

/** A keyframed `<param>`: time is in the clip's output axis, value uses the param's own unit. */
function keyframeParam<V>(
  name: string,
  base: string,
  clip: Clip,
  track: KeyframeTrack<V> | undefined,
  frames: number[],
  fps: number,
  value: (f: number) => string,
): XmlNode {
  const keyframes = [...frames]
    .sort((a, b) => a - b)
    .map((f) => {
      const attrs: Record<string, string> = { time: keyframeTime(f, clip, fps) };
      if (interpolationAt(clip, track, f) === "linear") attrs.curve = "linear";
      attrs.value = value(f);
      return el("keyframe", attrs);
    });
  return el("param", { name, value: base }, [el("keyframeAnimation", undefined, keyframes)]);
}

/**
 * A retimed clip's keyframes live in the timeMap's output axis, so `time` is offset by the clip's
 * `start` (= clipStart): `start + (f − startFrame)/fps`. Without it the animation lands before the
 * content and plays compressed. Unspeeded clips have no timeMap origin, so they stay clip-relative.
 */
function keyframeTime(f: number, clip: Clip, fps: number): string {
  if (Math.abs(clip.speed - 1.0) <= 0.001) return time(f - clip.startFrame, fps);
  const { p, q } = rationalSpeed(clip.speed);
  const num = clip.trimStartFrame * q + (f - clip.startFrame) * p;
  return rationalTime(num, fps * p);
}

function interpolationAt<V>(clip: Clip, track: KeyframeTrack<V> | undefined, absoluteFrame: number): string | undefined {
  return track?.keyframes.find((k) => clip.startFrame + k.frame === absoluteFrame)?.interpolationOut;
}

function keyframeFrames<V>(clip: Clip, track: KeyframeTrack<V> | undefined): number[] {
  return track ? track.keyframes.map((k) => clip.startFrame + k.frame) : [];
}

// MARK: - Retime (speed / timeMap)

/**
 * Source in-point in the post-retime output axis Resolve expects (source ÷ speed); the raw
 * source frame when unspeeded. `origin` is the asset's embedded start timecode, added only to the
 * unspeeded case (a retimed clip carries its origin in the timeMap values, not in `start`).
 */
function clipStart(clip: Clip, fps: number, origin = 0): string {
  if (Math.abs(clip.speed - 1.0) <= 0.001) return time(origin + clip.trimStartFrame, fps);
  const { p, q } = rationalSpeed(clip.speed);
  return rationalTime(clip.trimStartFrame * q, fps * p);
}

/**
 * Resolve ramps the WHOLE media (`output[0, media/speed] → source[0, media]`) and windows in via
 * `start`/`duration`. A ramp that stops at the clip edge leaves no tail mapping → black last frames.
 */
function timeMapNode(clip: Clip, fps: number, mediaFrames: number, origin = 0): XmlNode | undefined {
  if (Math.abs(clip.speed - 1.0) <= 0.001 || mediaFrames <= 0) return undefined;
  const { p, q } = rationalSpeed(clip.speed);
  return el("timeMap", { frameSampling: "floor" }, [
    el("timept", { time: "0s", value: time(origin, fps), interp: "linear" }),
    el("timept", {
      time: rationalTime(mediaFrames * q, fps * p), // media / speed
      value: time(origin + mediaFrames, fps), // full media from origin
      interp: "linear",
    }),
  ]);
}

/** Speed as a small-denominator fraction, so the timeMap slope is exact and `start` maps back to the original source frame. */
function rationalSpeed(speed: number): { p: number; q: number } {
  let best = { p: 1, q: 1 };
  let bestErr = Infinity;
  for (let q = 1; q <= 1000; q++) {
    const p = roundHalfAwayFromZero(speed * q);
    if (p <= 0) continue;
    const err = Math.abs(speed - p / q);
    if (err < bestErr) {
      best = { p, q };
      bestErr = err;
      if (err === 0) break;
    }
  }
  return best;
}

// MARK: - Emittable clips / lanes

function emittableClips(timeline: Timeline, entriesById: Map<string, MediaManifestEntry>): EmittableClip[] {
  const visualTrackCount = timeline.tracks.filter((t) => clipTypeIsVisual(t.type)).length;
  let visualOrdinal = 0;
  let audioOrdinal = 0;
  const clips: EmittableClip[] = [];

  for (const track of timeline.tracks) {
    let lane: number;
    let enabled: boolean;
    if (clipTypeIsVisual(track.type)) {
      lane = visualTrackCount - visualOrdinal;
      enabled = !track.hidden;
      visualOrdinal += 1;
    } else if (track.type === "audio") {
      lane = -(audioOrdinal + 1);
      enabled = !track.muted;
      audioOrdinal += 1;
    } else {
      continue;
    }
    const sorted = track.clips
      .filter((c) => isEmittable(c, entriesById))
      .sort((a, b) => a.startFrame - b.startFrame)
      .map((clip) => ({ clip, lane, enabled }));
    clips.push(...sorted);
  }
  return clips;
}

function isEmittable(clip: Clip, entriesById: Map<string, MediaManifestEntry>): boolean {
  if (clip.durationFrames <= 0) return false;
  switch (clip.mediaType) {
    case "text":
      return !!clip.textContent && clip.textContent.length > 0;
    case "lottie":
      return false;
    case "audio":
    case "video":
    case "image":
      return entriesById.has(clip.mediaRef);
  }
}

// MARK: - Rational time / number formatting

function time(frames: number, fps: number): string {
  if (frames === 0) return "0s";
  const divisor = gcd(Math.abs(frames), fps);
  const numerator = frames / divisor;
  const denominator = fps / divisor;
  return denominator === 1 ? `${numerator}s` : `${numerator}/${denominator}s`;
}

function rationalTime(num: number, den: number): string {
  if (num === 0) return "0s";
  const g = gcd(Math.abs(num), Math.abs(den));
  const n = num / g;
  const d = den / g;
  return d === 1 ? `${n}s` : `${n}/${d}s`;
}

function gcd(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y !== 0) {
    const r = x % y;
    x = y;
    y = r;
  }
  return Math.max(1, x);
}

function roundToPlaces(value: number, places: number): number {
  const factor = Math.pow(10, places);
  return roundHalfAwayFromZero(value * factor) / factor;
}

function formatNumber(value: number): string {
  const rounded = roundToPlaces(value, 4);
  if (roundHalfAwayFromZero(rounded) === rounded) return `${Math.trunc(rounded)}`;
  let s = rounded.toFixed(4);
  while (s.endsWith("0")) s = s.slice(0, -1);
  if (s.endsWith(".")) s = s.slice(0, -1);
  return s;
}

// MARK: - Format naming (frame rate / resolution)

function videoFormatName(width: number, height: number, rawFPS: number): string {
  return recognizedVideoFormatName(width, height, rawFPS) ?? `FFVideoFormat${width}x${height}p${formatRateSuffix(rawFPS)}`;
}

function sequenceFormatName(width: number, height: number, rawFPS: number): string {
  return recognizedVideoFormatName(width, height, rawFPS) ?? "FFVideoFormatRateUndefined";
}

function recognizedVideoFormatName(width: number, height: number, rawFPS: number): string | undefined {
  const rate = formatRateSuffix(rawFPS);
  if (width === 1280 && height === 720) return `FFVideoFormat720p${rate}`;
  if (width === 1920 && height === 1080) return `FFVideoFormat1080p${rate}`;
  if (width === 3840 && height === 2160) return `FFVideoFormat3840x2160p${rate}`;
  if (width === 4096 && height === 2160) return `FFVideoFormat4096x2160p${rate}`;
  return undefined;
}

function formatRateSuffix(rawFPS: number): string {
  const rounded = Math.max(1, roundHalfAwayFromZero(rawFPS));
  const ntscRate = (rounded * 1000) / 1001;
  if (Math.abs(rawFPS - ntscRate) < Math.abs(rawFPS - rounded)) {
    const fps100 = roundHalfAwayFromZero(ntscRate * 100);
    const whole = Math.trunc(fps100 / 100);
    const frac = fps100 % 100;
    return `${whole}${frac < 10 ? `0${frac}` : `${frac}`}`;
  }
  return `${rounded}`;
}

function frameDuration(rawFPS: number): string {
  const rounded = Math.max(1, roundHalfAwayFromZero(rawFPS));
  const ntscRate = (rounded * 1000) / 1001;
  if (Math.abs(rawFPS - ntscRate) < Math.abs(rawFPS - rounded)) {
    return `1001/${rounded * 1000}s`;
  }
  return `1/${rounded}s`;
}

// MARK: - XML node builder

function el(tag: string, attrs?: Record<string, string>, children?: (XmlNode | string)[]): XmlNode {
  return attrs ? { tag, attrs, children } : { tag, children };
}
