import { type XmlNode, renderXml } from "./xml.js";
import { type SourceTimecode, roundHalfAwayFromZero } from "./source-timecode.js";
import { collectMediaResources } from "./media-resources.js";
import { type Timeline, type Track, timelineTotalFrames } from "../timeline.js";
import {
  type Clip,
  clipEndFrame,
  sourceFramesConsumed,
  sourceDurationFrames,
  rawVolumeAt,
  rawOpacityAt,
  transformAt,
  sizeAt,
  rotationAt,
  cropAt,
} from "../clip.js";
import type { MediaManifestEntry } from "../media.js";
import { clipTypeIsVisual } from "../clip-type.js";
import { type Crop, type Transform, cropIsIdentity } from "../transform.js";
import type { KeyframeTrack } from "../keyframe.js";
import { secondsToFrame } from "../time.js";

/**
 * Exports a Timeline as XMEML 4 (Final Cut Pro 7 XML) for Premiere Pro. Faithful port of Swift's
 * `XMLExporter` (`Export/XMLExporter.swift`) — read that file before touching this one.
 *
 * What transports: clip placement/trims, speed (Time Remap filter), volume static+keyframed (Audio
 * Levels), opacity static+keyframed (Opacity filter), transform static+keyframed (Basic Motion), crop
 * static+keyframed (Crop filter), fade in/out (single-sided transition), linked A/V (reciprocal
 * `<link>`), source timecode per #247 (per-file `<timecode>` only — clip start/end/in/out stay 0-based).
 *
 * What does NOT transport (dropped, matching Swift): text overlays, flips, keyframe interpolation
 * curves (linear/hold/smooth — keyframes import with default easing), Clip.effects.
 */
export function exportXmeml(
  timeline: Timeline,
  entries: MediaManifestEntry[],
  opts: { projectRoot?: string; projectName: string; startTimecodes: Map<string, SourceTimecode> },
): string {
  const ctx: Ctx = {
    timeline,
    fps: timeline.fps,
    seqWidth: timeline.width,
    seqHeight: timeline.height,
    entriesById: new Map(entries.map((e) => [e.id, e])),
    mediaResources: collectMediaResources(timeline, entries, opts.projectRoot, opts.projectName),
    startTimecodes: opts.startTimecodes,
    clipAddresses: new Map(),
    clipsByLinkGroup: new Map(),
    emittedFiles: new Set(),
  };

  // FCP XML orders video tracks bottom→top; our model stores them top→bottom.
  const videoTracks = timeline.tracks.filter((t) => clipTypeIsVisual(t.type)).reverse();
  const audioTracks = timeline.tracks.filter((t) => t.type === "audio");
  const sortedVideo = videoTracks.map((t) => sortEmittable(ctx, t));
  const sortedAudio = audioTracks.map((t) => sortEmittable(ctx, t));

  indexAddresses(ctx, sortedVideo, false);
  indexAddresses(ctx, sortedAudio, true);
  indexLinkGroups(ctx);

  const videoTrackNodes = videoTracks.map((t, i) => trackNode(ctx, t, sortedVideo[i]!, false));
  const audioTrackNodes = audioTracks.map((t, i) => trackNode(ctx, t, sortedAudio[i]!, true));

  const root = el(
    "xmeml",
    [
      el(
        "sequence",
        [
          leaf("name", "Timeline Export"),
          leaf("duration", timelineTotalFrames(timeline)),
          rate(ctx.fps),
          timecodeShellNode(ctx),
          el("media", [
            el("video", [videoFormatNode(ctx), ...videoTrackNodes]),
            el("audio", [leaf("numOutputChannels", 2), audioFormatNode(), audioOutputsNode(), ...audioTrackNodes]),
          ]),
        ],
        { id: "sequence-1" },
      ),
    ],
    { version: "4" },
  );

  return renderXml(root, { declaration: '<?xml version="1.0" encoding="UTF-8"?>', doctype: "<!DOCTYPE xmeml>" });
}

// MARK: - Context

interface ClipAddress {
  trackIndex: number;
  clipIndex: number;
  isAudio: boolean;
}

interface Ctx {
  timeline: Timeline;
  fps: number;
  seqWidth: number;
  seqHeight: number;
  entriesById: Map<string, MediaManifestEntry>;
  mediaResources: ReturnType<typeof collectMediaResources>;
  startTimecodes: Map<string, SourceTimecode>;
  /** Clip id → position within its media type, used to emit `<link>` cross-references. */
  clipAddresses: Map<string, ClipAddress>;
  clipsByLinkGroup: Map<string, Clip[]>;
  /** `${mediaRef}|${isAudio}` keys already emitted in full; repeats collapse to `<file id="..."/>`. */
  emittedFiles: Set<string>;
}

// MARK: - Document shell

function timecodeShellNode(ctx: Ctx): XmlNode {
  return el("timecode", [
    rate(ctx.fps),
    leaf("string", "00:00:00:00"),
    leaf("frame", 0),
    leaf("source", "source"),
    leaf("displayformat", "NDF"),
  ]);
}

function videoFormatNode(ctx: Ctx): XmlNode {
  return el("format", [
    el("samplecharacteristics", [
      leaf("width", ctx.seqWidth),
      leaf("height", ctx.seqHeight),
      boolLeaf("anamorphic", false),
      leaf("pixelaspectratio", "square"),
      leaf("fielddominance", "none"),
      rate(ctx.fps),
    ]),
  ]);
}

function audioFormatNode(): XmlNode {
  return el("format", [el("samplecharacteristics", [leaf("samplerate", 48000), leaf("depth", 16)])]);
}

function audioOutputsNode(): XmlNode {
  return el("outputs", [
    el("group", [
      leaf("index", 1),
      leaf("numchannels", 2),
      leaf("downmix", 0),
      el("channel", [leaf("index", 1)]),
      el("channel", [leaf("index", 2)]),
    ]),
  ]);
}

// MARK: - Tracks → clipitems

function trackNode(ctx: Ctx, track: Track, sortedClips: Clip[], isAudio: boolean): XmlNode {
  const enabled = isAudio ? !track.muted : !track.hidden;
  const children: XmlNode[] = [boolLeaf("enabled", enabled), boolLeaf("locked", false)];
  for (const clip of sortedClips) {
    const fadeIn = fadeTransition(ctx, clip, "left", isAudio);
    if (fadeIn) children.push(fadeIn);
    children.push(clipItemNode(ctx, clip, isAudio));
    const fadeOut = fadeTransition(ctx, clip, "right", isAudio);
    if (fadeOut) children.push(fadeOut);
  }
  return el("track", children);
}

function clipItemNode(ctx: Ctx, clip: Clip, isAudio: boolean): XmlNode {
  const sourceDuration = entrySourceDurationFrames(ctx, clip.mediaRef) ?? sourceDurationFrames(clip);
  // in/out are source-frame offsets, so they span sourceFramesConsumed (Time Remap handles rate).
  const inPoint = clip.trimStartFrame;
  const outPoint = clip.trimStartFrame + sourceFramesConsumed(clip);

  const children: XmlNode[] = [
    leaf("masterclipid", masterclipId(clip, isAudio)),
    leaf("name", displayName(ctx, clip.mediaRef)),
    boolLeaf("enabled", true),
    leaf("duration", sourceDuration),
    rate(ctx.fps),
    leaf("start", clip.startFrame),
    leaf("end", clipEndFrame(clip)),
    leaf("in", inPoint),
    leaf("out", outPoint),
    fileNode(ctx, clip.mediaRef, isAudio),
  ];
  const remap = timeRemapFilter(clip.speed, isAudio);
  if (remap) children.push(remap);
  children.push(...(isAudio ? volumeFilters(clip) : videoFilters(ctx, clip)));
  children.push(...linkNodes(ctx, clip));
  return el("clipitem", children, { id: `clipitem-${clip.id}` });
}

function masterclipId(clip: Clip, isAudio: boolean): string {
  if (clip.linkGroupId) return `masterclip-${clip.linkGroupId}`;
  return `masterclip-${clip.mediaRef}-${isAudio ? "audio" : "video"}`;
}

function displayName(ctx: Ctx, mediaRef: string): string {
  return ctx.entriesById.get(mediaRef)?.name ?? "Offline";
}

function entrySourceDurationFrames(ctx: Ctx, mediaRef: string): number | undefined {
  const entry = ctx.entriesById.get(mediaRef);
  if (!entry) return undefined;
  return Math.max(0, secondsToFrame(entry.duration, ctx.fps));
}

// MARK: - File elements

/** Separate ids per media type — Premiere rejects a clipitem pointing at a `<file>` of the wrong type. */
function fileNode(ctx: Ctx, mediaRef: string, isAudio: boolean): XmlNode {
  const fileId = `file-${mediaRef}-${isAudio ? "audio" : "video"}`;
  const key = `${mediaRef}|${isAudio}`;
  if (ctx.emittedFiles.has(key)) return el("file", [], { id: fileId });
  ctx.emittedFiles.add(key);

  const resource = ctx.mediaResources.byRef.get(mediaRef);
  const entry = ctx.entriesById.get(mediaRef);
  const fileName = resource?.fileName ?? entry?.name ?? mediaRef;
  // Resolve needs Premiere's extra-slash host form; the canonical single-slash one fails.
  const pathUrl = resource ? resource.fileUrl.replace(/^file:\/\//, "file://localhost//") : `media/${mediaRef}`;

  const isImage = entry?.type === "image";
  const durationFrames = isImage ? 1 : entry ? Math.max(0, secondsToFrame(entry.duration, ctx.fps)) : 0;
  const { timebase, ntsc } = rateTags(entry?.sourceFPS ?? ctx.fps);

  const media: XmlNode = isAudio
    ? el("media", [
        el("audio", [
          el("samplecharacteristics", [leaf("samplerate", 48000), leaf("depth", 16)]),
          leaf("channelcount", 2),
        ]),
      ])
    : el("media", [
        el("video", [
          ...(isImage ? [leaf("duration", 1)] : []),
          el("samplecharacteristics", [
            leaf("width", entry?.sourceWidth ?? ctx.seqWidth),
            leaf("height", entry?.sourceHeight ?? ctx.seqHeight),
            boolLeaf("anamorphic", false),
            leaf("pixelaspectratio", "square"),
            leaf("fielddominance", "none"),
            rate(timebase, ntsc),
          ]),
        ]),
      ]);

  // timecode is required for DaVinci Resolve; computed by the unit-tested timecodeTags below.
  const tc = timecodeTags(ctx.startTimecodes.get(mediaRef), timebase, ntsc);
  const timecode = el("timecode", [
    rate(tc.base, tc.ntsc),
    leaf("string", tc.string),
    leaf("frame", tc.frame),
    leaf("displayformat", tc.dropFrame ? "DF" : "NDF"),
  ]);

  return el(
    "file",
    [leaf("name", fileName), leaf("pathurl", pathUrl), rate(timebase, ntsc), leaf("duration", durationFrames), timecode, media],
    { id: fileId },
  );
}

/** Real fps → FCP7 (timebase, ntsc). NTSC rates (timebase×1000/1001: 29.97, 23.976, …) set ntsc TRUE. */
function rateTags(rawFps: number): { timebase: number; ntsc: boolean } {
  const timebase = Math.max(1, roundHalfAwayFromZero(rawFps));
  const ntscRate = (timebase * 1000) / 1001;
  const ntsc = Math.abs(rawFps - ntscRate) < Math.abs(rawFps - timebase);
  return { timebase, ntsc };
}

// MARK: - Source timecode

interface TimecodeTags {
  base: number;
  ntsc: boolean;
  frame: number;
  dropFrame: boolean;
  string: string;
}

/**
 * The `<timecode>` values to emit for a file. A `tmcd` timecode runs at its own rate (often 30 DF
 * even on 60p footage), so when present it — not the video rate — drives the rate/format. When absent,
 * fall back to the video rate and emit a dummy 00:00:00:00.
 */
function timecodeTags(source: SourceTimecode | undefined, videoTimebase: number, videoNtsc: boolean): TimecodeTags {
  const base = source?.quanta ?? videoTimebase;
  const dropFrame = source?.dropFrame ?? (videoNtsc && videoTimebase % 30 === 0);
  const ntsc = dropFrame ? true : videoNtsc;
  const frame = source?.frame ?? 0;
  return { base, ntsc, frame, dropFrame, string: formatSmpteTimecode(frame, base, dropFrame) };
}

/** Frame count → SMPTE string; drop-frame (29.97/59.94) uses `;` separators and skips dropped frames. */
function formatSmpteTimecode(frame: number, fps: number, dropFrame: boolean): string {
  if (fps <= 0) return "00:00:00:00";
  let f = frame;
  if (dropFrame) {
    const drop = roundHalfAwayFromZero(fps * 0.066666); // 2 @ 30, 4 @ 60
    const d = Math.floor(f / (fps * 600));
    const m = f % (fps * 600);
    f += drop * 9 * d + (m > drop ? drop * Math.floor((m - drop) / (fps * 60)) : 0);
  }
  const sep = dropFrame ? ";" : ":";
  const ff = f % fps;
  const ss = Math.floor(f / fps) % 60;
  const mm = Math.floor(f / (fps * 60)) % 60;
  const hh = Math.floor(f / (fps * 3600));
  return [hh, mm, ss, ff].map(pad2).join(sep);
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

// MARK: - Links

/** Linked clips emit a `<link>` per partner so Premiere rebuilds the A/V pair. */
function linkNodes(ctx: Ctx, clip: Clip): XmlNode[] {
  const group = clip.linkGroupId;
  if (!group) return [];
  const partners = ctx.clipsByLinkGroup.get(group);
  if (!partners || partners.length <= 1) return [];
  const nodes: XmlNode[] = [];
  for (const partner of partners) {
    const addr = ctx.clipAddresses.get(partner.id);
    if (!addr) continue;
    nodes.push(
      el("link", [
        leaf("linkclipref", `clipitem-${partner.id}`),
        leaf("mediatype", addr.isAudio ? "audio" : "video"),
        leaf("trackindex", addr.trackIndex),
        leaf("clipindex", addr.clipIndex),
      ]),
    );
  }
  return nodes;
}

// MARK: - Transitions (fades)

/** A fade exports as a single-sided dissolve to black/silence (no clip-to-clip model). */
function fadeTransition(ctx: Ctx, clip: Clip, edge: "left" | "right", isAudio: boolean): XmlNode | undefined {
  const frames = edge === "left" ? clip.fadeInFrames : clip.fadeOutFrames;
  if (frames <= 0) return undefined;

  let start: number;
  let end: number;
  let alignment: string;
  let cutFrames: number;
  if (edge === "left") {
    start = clip.startFrame;
    end = clip.startFrame + frames;
    alignment = "start-black";
    cutFrames = 0;
  } else {
    start = clipEndFrame(clip) - frames;
    end = clipEndFrame(clip);
    alignment = "end-black";
    cutFrames = frames;
  }

  const children: XmlNode[] = [leaf("start", start), leaf("end", end), leaf("alignment", alignment)];
  if (isAudio) {
    children.push(rate(ctx.fps));
    children.push(effect("Cross Fade ( 0dB)", "KGAudioTransCrossFade0dB", "transition", "audio"));
  } else {
    // Premiere's private cut-point, in ticks (254016000000/sec): 0 for fade-in, full length for fade-out.
    const cutPointTicks = cutFrames * Math.trunc(254_016_000_000 / ctx.fps);
    children.push(leaf("cutPointTicks", String(cutPointTicks)));
    children.push(rate(ctx.fps));
    children.push(
      effect("Cross Dissolve", "Cross Dissolve", "transition", "video", {
        category: "Dissolve",
        body: [
          leaf("wipecode", 0),
          leaf("wipeaccuracy", 100),
          leaf("startratio", 0),
          leaf("endratio", 1),
          boolLeaf("reverse", false),
        ],
      }),
    );
  }
  return el("transitionitem", children);
}

// MARK: - Filters

/** Premiere needs this to apply speed; it won't infer it from the in/out vs start/end ratio. */
function timeRemapFilter(speed: number, isAudio: boolean): XmlNode | undefined {
  if (speed === 1) return undefined;
  return filter(
    effect("Time Remap", "timeremap", "motion", isAudio ? "audio" : "video", {
      body: [
        parameter("variablespeed", "variablespeed", { min: "0", max: "1", value: leaf("value", 0) }),
        parameter("speed", "speed", { min: "-100000", max: "100000", value: leaf("value", fixed(speed * 100, 4)) }),
        parameter("reverse", "reverse", { value: boolLeaf("value", false) }),
        parameter("frameblending", "frameblending", { value: boolLeaf("value", false) }),
      ],
    }),
  );
}

/**
 * `level` is linear (1 = 0 dB, clamped to ~3.98). Uses fade-excluded volume since fades export
 * separately as a transition.
 */
function volumeFilters(clip: Clip): XmlNode[] {
  const clampLevel = (v: number) => Math.max(0, Math.min(v, 3.98));
  const frames = keyframeFrames(clip, clip.volumeTrack);
  let level: XmlNode;
  if (frames.length === 0) {
    if (clip.volume === 1) return [];
    level = scalarParam("level", "Level", "0", "3.98107", clampLevel(clip.volume), [], 4);
  } else {
    const kfs = frames.map((f) => ({ when: f - clip.startFrame, value: clampLevel(rawVolumeAt(clip, f)) }));
    level = scalarParam("level", "Level", "0", "3.98107", kfs[0]!.value, kfs, 4);
  }
  return [filter(effect("Audio Levels", "audiolevels", "audio", "audio", { body: [level] }))];
}

function videoFilters(ctx: Ctx, clip: Clip): XmlNode[] {
  return [motionFilter(ctx, clip), cropFilter(clip), opacityFilter(clip)].filter((n): n is XmlNode => !!n);
}

/** Basic Motion: scale, rotation, center — keyframed, or static (defaults omitted). */
function motionFilter(ctx: Ctx, clip: Clip): XmlNode | undefined {
  const sourceWidth = ctx.entriesById.get(clip.mediaRef)?.sourceWidth ?? 0;
  const scalePct = (width: number) => (sourceWidth > 0 ? (ctx.seqWidth / sourceWidth) * width * 100 : width * 100);
  // FCP7 center uses normalized coordinates (0 = center), not pixels.
  const center = (t: Transform) => ({ x: t.centerX - 0.5, y: t.centerY - 0.5 });

  // Center depends on position + scale, so sample all transform params at the union of frames.
  const frames = Array.from(
    new Set([
      ...keyframeFrames(clip, clip.positionTrack),
      ...keyframeFrames(clip, clip.scaleTrack),
      ...keyframeFrames(clip, clip.rotationTrack),
    ]),
  ).sort((a, b) => a - b);

  let params: XmlNode[];
  if (frames.length === 0) {
    const t = clip.transform;
    const c = center(t);
    const scaled = scalePct(t.width);
    const rotated = -t.rotation;
    const needsCenter = Math.abs(c.x) > 0.001 || Math.abs(c.y) > 0.001; // normalized, so a small epsilon
    const needsScale = Math.abs(scaled - 100) > 0.1;
    const needsRotation = Math.abs(rotated) > 0.05;
    if (!needsCenter && !needsScale && !needsRotation) return undefined;
    params = [];
    if (needsScale) params.push(scalarParam("scale", "Scale", "0", "1000", scaled));
    if (needsRotation) params.push(scalarParam("rotation", "Rotation", "-100000", "100000", rotated));
    if (needsCenter) params.push(centerParam(c));
  } else {
    const scaleKfs = frames.map((f) => ({ when: f - clip.startFrame, value: scalePct(sizeAt(clip, f).width) }));
    const rotationKfs = frames.map((f) => ({ when: f - clip.startFrame, value: -rotationAt(clip, f) }));
    const centerKfs = frames.map((f) => {
      const c = center(transformAt(clip, f));
      return { when: f - clip.startFrame, x: c.x, y: c.y };
    });
    params = [
      scalarParam("scale", "Scale", "0", "1000", scaleKfs[0]!.value, scaleKfs),
      scalarParam("rotation", "Rotation", "-100000", "100000", rotationKfs[0]!.value, rotationKfs),
      centerParam({ x: centerKfs[0]!.x, y: centerKfs[0]!.y }, centerKfs),
    ];
  }
  return filter(effect("Basic Motion", "basic", "motion", "video", { body: params }));
}

/** Crop filter — edge insets as 0–100 percentages (our model stores 0–1 fractions). */
function cropFilter(clip: Clip): XmlNode | undefined {
  const frames = keyframeFrames(clip, clip.cropTrack);
  if (frames.length === 0 && cropIsIdentity(clip.crop)) return undefined;

  const edgeParam = (id: string, key: keyof Crop): XmlNode => {
    if (frames.length === 0) {
      return scalarParam(id, id, "0", "100", clip.crop[key] * 100);
    }
    const kfs = frames.map((f) => ({ when: f - clip.startFrame, value: cropAt(clip, f)[key] * 100 }));
    return scalarParam(id, id, "0", "100", kfs[0]!.value, kfs);
  };
  const params = [edgeParam("left", "left"), edgeParam("right", "right"), edgeParam("top", "top"), edgeParam("bottom", "bottom")];
  return filter(effect("Crop", "crop", "motion", "video", { category: "motion", body: params }));
}

/** FCP7 keeps opacity in its own Opacity effect (Basic Motion has no opacity parameter). */
function opacityFilter(clip: Clip): XmlNode | undefined {
  const frames = keyframeFrames(clip, clip.opacityTrack);
  let opacity: XmlNode;
  if (frames.length === 0) {
    if (clip.opacity === 1) return undefined;
    opacity = scalarParam("opacity", "Opacity", "0", "100", clip.opacity * 100, [], 1);
  } else {
    const kfs = frames.map((f) => ({ when: f - clip.startFrame, value: rawOpacityAt(clip, f) * 100 }));
    opacity = scalarParam("opacity", "Opacity", "0", "100", kfs[0]!.value, kfs, 1);
  }
  return filter(effect("Opacity", "opacity", "motion", "video", { body: [opacity] }));
}

// MARK: - Indexing helpers

/** Drops unresolvable clips (no manifest entry) so track builders and `<link>` indices agree. */
function sortEmittable(ctx: Ctx, track: Track): Clip[] {
  return track.clips.filter((c) => ctx.mediaResources.byRef.has(c.mediaRef)).sort((a, b) => a.startFrame - b.startFrame);
}

function indexAddresses(ctx: Ctx, sortedTracks: Clip[][], isAudio: boolean): void {
  sortedTracks.forEach((clips, ti) => {
    clips.forEach((clip, ci) => {
      ctx.clipAddresses.set(clip.id, { trackIndex: ti + 1, clipIndex: ci + 1, isAudio });
    });
  });
}

function indexLinkGroups(ctx: Ctx): void {
  for (const track of ctx.timeline.tracks) {
    for (const clip of track.clips) {
      if (!clip.linkGroupId) continue;
      const list = ctx.clipsByLinkGroup.get(clip.linkGroupId) ?? [];
      list.push(clip);
      ctx.clipsByLinkGroup.set(clip.linkGroupId, list);
    }
  }
}

function keyframeFrames<V>(clip: Clip, track: KeyframeTrack<V> | undefined): number[] {
  return track ? track.keyframes.map((k) => clip.startFrame + k.frame) : [];
}

// MARK: - Effect & parameter builders

function rate(timebase: number, ntsc = false): XmlNode {
  return el("rate", [leaf("timebase", timebase), boolLeaf("ntsc", ntsc)]);
}

function filter(effectNode: XmlNode): XmlNode {
  return el("filter", [effectNode]);
}

function effect(
  name: string,
  id: string,
  type: string,
  mediatype: string,
  opts?: { category?: string; body?: XmlNode[] },
): XmlNode {
  const children: XmlNode[] = [leaf("name", name), leaf("effectid", id)];
  if (opts?.category) children.push(leaf("effectcategory", opts.category));
  children.push(leaf("effecttype", type));
  children.push(leaf("mediatype", mediatype));
  children.push(...(opts?.body ?? []));
  return el("effect", children);
}

/** A `<parameter>`; `value` is its `<value>` node, optionally animated by `keyframes`. */
function parameter(
  id: string,
  name: string,
  opts: { min?: string; max?: string; value: XmlNode; keyframes?: { when: number; value: XmlNode }[] },
): XmlNode {
  const children: XmlNode[] = [leaf("parameterid", id), leaf("name", name)];
  if (opts.min !== undefined) children.push(leaf("valuemin", opts.min));
  if (opts.max !== undefined) children.push(leaf("valuemax", opts.max));
  children.push(opts.value);
  for (const kf of opts.keyframes ?? []) children.push(el("keyframe", [leaf("when", kf.when), kf.value]));
  return el("parameter", children);
}

/** Scalar `<parameter>` whose value (and keyframes) are numbers formatted to `decimals` places. */
function scalarParam(
  id: string,
  name: string,
  min: string,
  max: string,
  base: number,
  keyframes: { when: number; value: number }[] = [],
  decimals = 2,
): XmlNode {
  return parameter(id, name, {
    min,
    max,
    value: leaf("value", fixed(base, decimals)),
    keyframes: keyframes.map((kf) => ({ when: kf.when, value: leaf("value", fixed(kf.value, decimals)) })),
  });
}

/** Two-component Center `<parameter>` whose value is a `<horiz>`/`<vert>` pair. */
function centerParam(base: { x: number; y: number }, keyframes: { when: number; x: number; y: number }[] = []): XmlNode {
  const vec = (x: number, y: number) => el("value", [leaf("horiz", fixed(x, 5)), leaf("vert", fixed(y, 5))]);
  return parameter("center", "Center", {
    value: vec(base.x, base.y),
    keyframes: keyframes.map((kf) => ({ when: kf.when, value: vec(kf.x, kf.y) })),
  });
}

function fixed(value: number, decimals: number): string {
  return value.toFixed(decimals);
}

// MARK: - XML node builders

function el(tag: string, children: (XmlNode | string)[] = [], attrs?: Record<string, string | number>): XmlNode {
  return attrs ? { tag, attrs, children } : { tag, children };
}

function leaf(tag: string, value: string | number): XmlNode {
  return { tag, children: [String(value)] };
}

function boolLeaf(tag: string, value: boolean): XmlNode {
  return { tag, children: [value ? "TRUE" : "FALSE"] };
}
