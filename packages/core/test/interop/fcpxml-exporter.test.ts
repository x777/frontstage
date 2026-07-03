import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { exportFcpxml } from "../../src/interop/fcpxml-exporter.js";
import type { Clip } from "../../src/clip.js";
import type { Track, Timeline } from "../../src/timeline.js";
import type { MediaManifestEntry } from "../../src/media.js";
import type { SourceTimecode } from "../../src/interop/source-timecode.js";

// --- Fixtures ---
// Golden .fcpxml files under __fixtures__ were generated from this exporter and hand-verified
// line by line (and number by number) against Swift's Export/FCPXMLExporter.swift rules —
// rational-time fractions, the #247 axis rule (clipStart/timeMapNode's `origin` param), keyframe
// time-offset/curve math, FCP position/scale/rotation encoding, dB volume, NTSC frameDuration,
// and (#254) flat asset-clips / one-sided-A-V compounds / resolve-target crop-position
// calibration. See the task report for the full numeric trace. They pin regressions from here on.

function makeClip(overrides: Partial<Clip> & { id: string; mediaRef: string }): Clip {
  return {
    mediaType: "video",
    sourceClipType: "video",
    startFrame: 0,
    durationFrames: 60,
    trimStartFrame: 0,
    trimEndFrame: 0,
    speed: 1,
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    fadeInInterpolation: "linear",
    fadeOutInterpolation: "linear",
    opacity: 1,
    transform: { centerX: 0.5, centerY: 0.5, width: 1, height: 1, rotation: 0, flipHorizontal: false, flipVertical: false },
    crop: { left: 0, top: 0, right: 0, bottom: 0 },
    ...overrides,
  };
}
function makeTrack(clips: Clip[], id = "t1", type: Track["type"] = "video"): Track {
  return { id, type, muted: false, hidden: false, syncLocked: false, clips };
}
function makeTimeline(tracks: Track[], overrides: Partial<Timeline> = {}): Timeline {
  return { fps: 30, width: 1920, height: 1080, settingsConfigured: true, tracks, ...overrides };
}
function videoEntry(id: string, overrides: Partial<MediaManifestEntry> = {}): MediaManifestEntry {
  return { id, name: id, type: "video", source: { kind: "external", absolutePath: `/media/${id}.mp4` }, duration: 5, ...overrides };
}
function audioEntry(id: string, overrides: Partial<MediaManifestEntry> = {}): MediaManifestEntry {
  return { id, name: id, type: "audio", source: { kind: "external", absolutePath: `/media/${id}.m4a` }, duration: 5, ...overrides };
}
function fixture(name: string): string {
  return readFileSync(new URL(`./__fixtures__/${name}.fcpxml`, import.meta.url), "utf-8");
}

// --- Goldens ---

describe("exportFcpxml — goldens", () => {
  it("minimal 1-clip video export: header, resources (format/asset), single flat asset-clip", () => {
    const entries = [videoEntry("media-1", { name: "MyVideo" })];
    const clip = makeClip({ id: "clip-1", mediaRef: "media-1", startFrame: 30, durationFrames: 60 });
    const timeline = makeTimeline([makeTrack([clip])]);
    const xml = exportFcpxml(timeline, entries, { projectName: "Proj", startTimecodes: new Map() });
    expect(xml).toBe(fixture("fcpxml-minimal"));
    // #247: relink name = filename WITH extension, not the manifest display name ("MyVideo").
    expect(xml).toContain('name="media-1.mp4"');
    expect(xml).not.toContain("MyVideo");
    // #254: an audio-less source needs no compound — the clip is a flat asset-clip.
    expect(xml).not.toContain("<ref-clip");
    expect(xml).not.toContain("<media id=");
  });

  it("one-sided A/V + tc origin (#247/#254 core case): asset + compound inner carry tc, outer ref-clip stays 0-based", () => {
    const entries = [videoEntry("av-1", { hasAudio: true })];
    // Unlinked (no linkGroupId): the video plays alone, so it rides the compound via srcEnable.
    const videoClip = makeClip({ id: "vc", mediaRef: "av-1", mediaType: "video", startFrame: 0, durationFrames: 60 });
    const timeline = makeTimeline([makeTrack([videoClip], "vt1", "video")]);
    const tc: SourceTimecode = { frame: 900, quanta: 30, dropFrame: false }; // 30s at 30fps
    const xml = exportFcpxml(timeline, entries, { projectName: "Proj", startTimecodes: new Map([["av-1", tc]]) });
    expect(xml).toBe(fixture("fcpxml-compound-tc"));

    // Axis rule, pinned explicitly: <asset> and the compound's inner <asset-clip> carry start="30s";
    // the outer <ref-clip> (and the compound spine's own offset) stay 0-based.
    expect(xml).toContain('<asset id="asset1" name="av-1.mp4" start="30s"');
    expect(xml).toContain('<asset-clip ref="asset1" name="av-1.mp4" duration="5s" start="30s" offset="0s"');
    expect(xml).toContain('<ref-clip ref="media1" name="av-1.mp4" lane="1" offset="0s" start="0s"');
    expect(xml).toContain('srcEnable="video"');
    expect(xml.match(/<ref-clip/g)).toHaveLength(1);
  });

  it("absent timecode ⇒ byte-identical to zero-based, except the <asset>/inner-clip start lines", () => {
    const entries = [videoEntry("av-1", { hasAudio: true })];
    const videoClip = makeClip({ id: "vc", mediaRef: "av-1", mediaType: "video", startFrame: 0, durationFrames: 60 });
    const timeline = makeTimeline([makeTrack([videoClip], "vt1", "video")]);
    const xmlAbsent = exportFcpxml(timeline, entries, { projectName: "Proj", startTimecodes: new Map() });
    expect(xmlAbsent).toBe(fixture("fcpxml-compound-tc-absent"));

    const absentLines = xmlAbsent.split("\n");
    const presentLines = fixture("fcpxml-compound-tc").split("\n");
    expect(presentLines).toHaveLength(absentLines.length);
    const changedIdx = presentLines.map((line, i) => (line !== absentLines[i] ? i : -1)).filter((i) => i !== -1);
    // Exactly the <asset> and inner compound <asset-clip> start attrs — nothing on the spine/outer axis.
    expect(changedIdx).toHaveLength(2);
    for (const i of changedIdx) {
      expect(absentLines[i]).toContain('start="0s"');
      expect(presentLines[i]).toContain('start="30s"');
    }
  });

  it("an unrelated mediaRef in startTimecodes does not affect output (absent ⇒ byte-identical)", () => {
    const entries = [videoEntry("media-1", { name: "MyVideo" })];
    const clip = makeClip({ id: "clip-1", mediaRef: "media-1", startFrame: 30, durationFrames: 60 });
    const timeline = makeTimeline([makeTrack([clip])]);
    const unrelated = new Map([["some-other-media", { frame: 10, quanta: 30, dropFrame: false } as SourceTimecode]]);
    const xml = exportFcpxml(timeline, entries, { projectName: "Proj", startTimecodes: unrelated });
    expect(xml).toBe(fixture("fcpxml-minimal"));
  });

  it("unlinked audio against an A/V source still routes through the compound (srcEnable=audio)", () => {
    const entries = [videoEntry("av-1", { hasAudio: true })];
    const videoClip = makeClip({ id: "vc", mediaRef: "av-1", mediaType: "video", startFrame: 0, durationFrames: 30 });
    const audioClip = makeClip({ id: "ac2", mediaRef: "av-1", mediaType: "audio", startFrame: 60, durationFrames: 30 });
    const timeline = makeTimeline([makeTrack([videoClip], "vt1", "video"), makeTrack([audioClip], "at1", "audio")]);
    const xml = exportFcpxml(timeline, entries, { projectName: "Proj", startTimecodes: new Map() });
    expect(xml).toBe(fixture("fcpxml-unlinked-audio-av"));
    expect(xml.match(/<ref-clip/g)).toHaveLength(2);
    expect(xml).toContain('srcEnable="audio"');
    expect(xml).toContain('srcEnable="video"');
  });

  it("retime (speed=2, trim=10): rational clipStart + whole-media timeMap ramp (origin folds only when uncompounded)", () => {
    const entries = [videoEntry("media-1", {})];
    const clip = makeClip({ id: "c1", mediaRef: "media-1", startFrame: 0, durationFrames: 200, trimStartFrame: 10, speed: 2.0 });
    const timeline = makeTimeline([makeTrack([clip])]);
    const xml = exportFcpxml(timeline, entries, { projectName: "Proj", startTimecodes: new Map() });
    expect(xml).toBe(fixture("fcpxml-retime"));
    // clipStart = trimStart(10) * q(1) / (fps(30) * p(2)) = 10/60 reduced = 1/6.
    expect(xml).toContain('start="1/6s"');
    // timeMap: media(410 frames = round(200*2)+10) ramps 0→media/speed (410/60=41/6s) mapping to
    // source[0, media] (0s → 41/3s, since 410 frames / 30fps = 41/3s).
    expect(xml).toContain('<timept time="0s" value="0s" interp="linear"/>');
    expect(xml).toContain('<timept time="41/6s" value="41/3s" interp="linear"/>');
  });

  it("keyframed transform (position/scale/rotation) + opacity: each interpolation kind (linear/hold/smooth)", () => {
    const entries = [videoEntry("media-1", { sourceWidth: 3840, sourceHeight: 2160 })];
    const clip = makeClip({
      id: "c1",
      mediaRef: "media-1",
      startFrame: 10,
      durationFrames: 100,
      opacityTrack: {
        keyframes: [
          { frame: 0, value: 1.0, interpolationOut: "linear" },
          { frame: 50, value: 0.5, interpolationOut: "hold" },
          { frame: 89, value: 0.2, interpolationOut: "smooth" },
        ],
      },
      scaleTrack: {
        keyframes: [
          { frame: 0, value: { a: 0.5, b: 0.5 }, interpolationOut: "linear" },
          { frame: 50, value: { a: 1, b: 1 }, interpolationOut: "smooth" },
        ],
      },
      rotationTrack: {
        keyframes: [
          { frame: 0, value: 0, interpolationOut: "hold" },
          { frame: 50, value: 45, interpolationOut: "linear" },
        ],
      },
    });
    const timeline = makeTimeline([makeTrack([clip])]);
    const xml = exportFcpxml(timeline, entries, { projectName: "Proj", startTimecodes: new Map() });
    expect(xml).toBe(fixture("fcpxml-keyframes"));
    // Only a "linear" keyframe's OWN interpolationOut adds curve="linear"; hold/smooth add none.
    expect(xml).toContain('<keyframe time="0s" curve="linear" value="0.5 0.5"/>'); // scale: linear
    expect(xml).toContain('<keyframe time="5/3s" value="1 1"/>'); // scale: smooth, no curve
    expect(xml).toContain('<keyframe time="0s" value="0"/>'); // rotation: hold, no curve
    expect(xml).toContain('<keyframe time="5/3s" curve="linear" value="-45"/>'); // rotation: linear, negated
    // Keyframe time is offset by clip.startFrame (the output axis): frame 10 -> "0s", frame 60 -> "5/3s".
    expect(xml).toContain('<param name="rotation" value="0">');
  });

  it("title clip: font/face/size/color/alignment, face is always Regular (no CoreText off-macOS)", () => {
    const clip = makeClip({
      id: "t1",
      mediaRef: "text-1",
      mediaType: "text",
      startFrame: 0,
      durationFrames: 60,
      textContent: "Hello",
      textStyle: {
        fontName: "Helvetica-Bold",
        fontSize: 96,
        fontScale: 1,
        color: { r: 1, g: 0, b: 0, a: 1 },
        alignment: "center",
        shadow: { enabled: true, color: { r: 0, g: 0, b: 0, a: 0.6 }, offsetX: 0, offsetY: -2, blur: 6 },
        background: { enabled: false, color: { r: 0, g: 0, b: 0, a: 0.6 } },
        border: { enabled: false, color: { r: 0, g: 0, b: 0, a: 1 } },
      },
    });
    const timeline = makeTimeline([makeTrack([clip])]);
    const xml = exportFcpxml(timeline, [], { projectName: "Proj", startTimecodes: new Map() });
    expect(xml).toBe(fixture("fcpxml-title"));
    expect(xml).toContain('font="Helvetica-Bold" fontFace="Regular" fontSize="96" fontColor="1 0 0 1" alignment="center"');
    // No media resource for a text-only clip.
    expect(xml).not.toContain("<asset ");
  });

  it("flip (negative scale) + static crop (no source dims ⇒ plain trim-rect percentages)", () => {
    const entries = [videoEntry("media-1", {})];
    const clip = makeClip({
      id: "c1",
      mediaRef: "media-1",
      startFrame: 0,
      durationFrames: 60,
      transform: { centerX: 0.5, centerY: 0.5, width: 1, height: 1, rotation: 0, flipHorizontal: true, flipVertical: false },
      crop: { left: 0.1, top: 0.05, right: 0.1, bottom: 0 },
    });
    const timeline = makeTimeline([makeTrack([clip])]);
    const xml = exportFcpxml(timeline, entries, { projectName: "Proj", startTimecodes: new Map() });
    expect(xml).toBe(fixture("fcpxml-flip-crop"));
    expect(xml).toContain('scale="-1 1"');
    // Unknown source dims (no sourceWidth/sourceHeight on the entry) ⇒ the resolve target falls back
    // to plain percentages, same as the fcp target.
    expect(xml).toContain('<trim-rect top="5" right="10" bottom="0" left="10"/>');
  });

  it("static non-zero position + rotation (non-centered clip, no scale/crop)", () => {
    const entries = [videoEntry("media-1", {})];
    const clip = makeClip({
      id: "c1",
      mediaRef: "media-1",
      startFrame: 0,
      durationFrames: 60,
      transform: { centerX: 0.545, centerY: 0.3, width: 1, height: 1, rotation: 15, flipHorizontal: false, flipVertical: false },
    });
    const timeline = makeTimeline([makeTrack([clip])]);
    const xml = exportFcpxml(timeline, entries, { projectName: "Proj", startTimecodes: new Map() });
    expect(xml).toBe(fixture("fcpxml-position"));
    // positionValue: unit = seqHeight/100 = 10.8. x = (centerX-0.5)*seqWidth/unit = 0.045*1920/10.8 = 8;
    // y = (0.5-centerY)*seqHeight/unit = 0.2*1080/10.8 = 20 — both exact, hand-verified against the
    // ported formula (both axes scaled by seqHeight, per FCP's "% of frame height" convention). No
    // source dims on the entry ⇒ conform-fit fraction is 1×1, so the resolve target changes nothing.
    expect(xml).toContain('<adjust-transform scale="1 1" rotation="-15" anchor="0 0" position="8 20"/>');
  });

  it("static volume (linear -> dB) on a standalone audio source; keyframed volume is DROPPED entirely", () => {
    const entries = [audioEntry("media-a", {})];
    const clip = makeClip({
      id: "ac",
      mediaRef: "media-a",
      mediaType: "audio",
      startFrame: 0,
      durationFrames: 60,
      volume: 0.5,
      volumeTrack: {
        keyframes: [
          { frame: 0, value: 0, interpolationOut: "linear" },
          { frame: 30, value: -6, interpolationOut: "linear" },
        ],
      },
    });
    const timeline = makeTimeline([makeTrack([clip], "at1", "audio")]);
    const xml = exportFcpxml(timeline, entries, { projectName: "Proj", startTimecodes: new Map() });
    expect(xml).toBe(fixture("fcpxml-volume"));
    // 20*log10(0.5) = -6.0206dB.
    expect(xml).toContain('<adjust-volume amount="-6.0206"/>');
    expect(xml).not.toContain("keyframeAnimation");
  });
});

// --- Version attribute ---

describe("exportFcpxml — version", () => {
  it("defaults to 1.10", () => {
    const entries = [videoEntry("media-1", {})];
    const clip = makeClip({ id: "c1", mediaRef: "media-1", startFrame: 0, durationFrames: 30 });
    const xml = exportFcpxml(makeTimeline([makeTrack([clip])]), entries, { projectName: "Proj", startTimecodes: new Map() });
    expect(xml).toContain('<fcpxml version="1.10">');
  });

  it("honors an explicit version override", () => {
    const entries = [videoEntry("media-1", {})];
    const clip = makeClip({ id: "c1", mediaRef: "media-1", startFrame: 0, durationFrames: 30 });
    const xml = exportFcpxml(makeTimeline([makeTrack([clip])]), entries, {
      projectName: "Proj",
      startTimecodes: new Map(),
      version: "1.13",
    });
    expect(xml).toContain('<fcpxml version="1.13">');
  });
});

// --- #254: flat asset-clips / compound gating ---

describe("exportFcpxml — flat asset-clips vs. one-sided A/V compounds (#254)", () => {
  it("one-sided A/V clip wraps the asset in a full-media compound ref-clip", () => {
    // The compound must hold the FULL media (5s), independent of the clip's trim/duration — that
    // runway is what stops Resolve blacking a retimed tail.
    const entries = [videoEntry("media-v", { hasAudio: true })];
    const clip = makeClip({ id: "c", mediaRef: "media-v", startFrame: 0, durationFrames: 30, trimStartFrame: 20 });
    const timeline = makeTimeline([makeTrack([clip])]);
    const xml = exportFcpxml(timeline, entries, { projectName: "Proj", startTimecodes: new Map() });

    expect(xml).toContain('<sequence format="r2" duration="5s"');
    expect(xml).toContain('<asset-clip ref="asset1" name="media-v.mp4" duration="5s" start="0s" offset="0s" format="r2"/>');
    expect(xml).toContain('<ref-clip ref="media1"');
    expect(xml).toContain('srcEnable="video"');
    expect(xml).toContain('<adjust-conform type="fit"/>');
  });

  it("audio-less video emits a flat asset-clip without a compound", () => {
    const entries = [videoEntry("media-v", {})];
    const clip = makeClip({ id: "c", mediaRef: "media-v", startFrame: 0, durationFrames: 30, trimStartFrame: 20 });
    const timeline = makeTimeline([makeTrack([clip])]);
    const xml = exportFcpxml(timeline, entries, { projectName: "Proj", startTimecodes: new Map() });

    expect(xml).not.toContain("<media id=");
    expect(xml).not.toContain("<ref-clip");
    expect(xml).toContain('<asset-clip ref="asset1" name="media-v.mp4" lane="1"');
    expect(xml).toContain('<adjust-conform type="fit"/>');
  });

  it("linked A/V pair collapses to one flat asset-clip, no compound emitted at all", () => {
    // A synced A/V pair (shared linkGroup, aligned) becomes a single flat <asset-clip> carrying both
    // streams. The separate audio clip is dropped so Resolve doesn't import a phantom video track.
    const entries = [videoEntry("media-v", { hasAudio: true })];
    const video = makeClip({ id: "video", mediaRef: "media-v", mediaType: "video", startFrame: 0, durationFrames: 30, linkGroupId: "pair" });
    const audio = makeClip({
      id: "audio",
      mediaRef: "media-v",
      mediaType: "audio",
      startFrame: 0,
      durationFrames: 30,
      volume: 0.5,
      linkGroupId: "pair",
    });
    const timeline = makeTimeline([makeTrack([video], "vt1", "video"), makeTrack([audio], "at1", "audio")]);
    const xml = exportFcpxml(timeline, entries, { projectName: "Proj", startTimecodes: new Map() });

    expect(xml).toContain('<asset-clip ref="asset1" name="media-v.mp4" lane="1"');
    expect(xml).not.toContain("<ref-clip");
    expect(xml).not.toContain("<media id=");
    expect(xml).not.toContain('lane="-1"');
    expect(xml).not.toContain("srcEnable=");
    // The dropped audio clip's volume rides on the surviving asset-clip.
    expect(xml).toContain('<adjust-volume amount="-6.0206"/>');
  });

  it("video clip: flat asset-clip with offset/start/duration, unaffected by the compound removal", () => {
    const entries = [videoEntry("media-v", {})];
    const clip = makeClip({ id: "clip-1", mediaRef: "media-v", startFrame: 30, durationFrames: 60, trimStartFrame: 10 });
    const timeline = makeTimeline([makeTrack([clip])]);
    const xml = exportFcpxml(timeline, entries, { projectName: "Proj", startTimecodes: new Map() });

    // Unspeeded: start is the raw source in-point (trimStart 10 / 30fps = 1/3s), no timeMap.
    expect(xml).toContain('<asset-clip ref="asset1" name="media-v.mp4" lane="1"');
    expect(xml).toContain('offset="1s"');
    expect(xml).toContain('start="1/3s"');
    expect(xml).toContain('duration="2s"');
    expect(xml).not.toContain("<timeMap");
  });

  it("still image emits a <video> element with transform — no ref-clip, no compound", () => {
    const entry: MediaManifestEntry = {
      id: "broll",
      name: "broll",
      type: "image",
      source: { kind: "external", absolutePath: "/media/broll.png" },
      duration: 0,
      sourceWidth: 1920,
      sourceHeight: 1080,
    };
    const clip = makeClip({
      id: "c",
      mediaRef: "broll",
      mediaType: "image",
      startFrame: 0,
      durationFrames: 30,
      transform: { centerX: 0.25, centerY: 0.75, width: 1, height: 1, rotation: 0, flipHorizontal: false, flipVertical: false },
    });
    const timeline = makeTimeline([makeTrack([clip])]);
    const xml = exportFcpxml(timeline, [entry], { projectName: "Proj", startTimecodes: new Map() });

    expect(xml).toContain('<video ref="asset1" name="broll.png" lane="1"');
    expect(xml).not.toContain("<ref-clip");
    expect(xml).not.toContain("<media id=");
    expect(xml).toContain('<adjust-transform scale="1 1" anchor="0 0" position="-44.4444 -25"/>');
  });

  it("a source path apostrophe percent-encodes in media-rep src (Resolve's relinker fails on &apos;)", () => {
    const entries = [videoEntry("sam's clip", {})];
    const clip = makeClip({ id: "c", mediaRef: "sam's clip", startFrame: 0, durationFrames: 30 });
    const timeline = makeTimeline([makeTrack([clip])]);
    const xml = exportFcpxml(timeline, entries, { projectName: "Proj", startTimecodes: new Map() });
    const rep = xml.split("<media-rep")[1]?.split("/>")[0] ?? "";

    expect(rep).toContain("%27");
    expect(rep).not.toContain("&apos;");
  });
});

// --- #254: text stroke (TextStyle.border) ---

describe("exportFcpxml — text border/stroke (#254)", () => {
  it("an enabled border exports strokeColor/strokeWidth (4% of font size, NSAttributedString's convention)", () => {
    const clip = makeClip({
      id: "title",
      mediaRef: "text",
      mediaType: "text",
      startFrame: 0,
      durationFrames: 60,
      textContent: "HOOK",
      textStyle: {
        fontName: "Helvetica-Bold",
        fontSize: 96,
        fontScale: 1,
        color: { r: 1, g: 1, b: 1, a: 1 },
        alignment: "center",
        shadow: { enabled: true, color: { r: 0, g: 0, b: 0, a: 0.6 }, offsetX: 0, offsetY: -2, blur: 6 },
        background: { enabled: false, color: { r: 0, g: 0, b: 0, a: 0.6 } },
        border: { enabled: true, color: { r: 0, g: 0, b: 0, a: 1 } },
      },
    });
    const timeline = makeTimeline([makeTrack([clip])]);
    const xml = exportFcpxml(timeline, [], { projectName: "Proj", startTimecodes: new Map() });

    // 4% of the 96pt font (NSAttributedString's stroke convention) = 3.84pt.
    expect(xml).toContain('strokeColor="0 0 0 1"');
    expect(xml).toContain('strokeWidth="3.84"');
  });

  it("a disabled border omits strokeColor/strokeWidth", () => {
    const clip = makeClip({
      id: "title",
      mediaRef: "text",
      mediaType: "text",
      startFrame: 0,
      durationFrames: 60,
      textContent: "HOOK",
    });
    const timeline = makeTimeline([makeTrack([clip])]);
    const xml = exportFcpxml(timeline, [], { projectName: "Proj", startTimecodes: new Map() });

    expect(xml).not.toContain("strokeColor=");
    expect(xml).not.toContain("strokeWidth=");
  });
});

// --- #254: fcpxmlTarget (resolve | fcp) crop/position calibration ---

describe("exportFcpxml — target-aware crop/position calibration (#254)", () => {
  it("defaults to the resolve target", () => {
    const entries = [videoEntry("media-v", { sourceWidth: 1280, sourceHeight: 720 })];
    const clip = makeClip({
      id: "clip-1",
      mediaRef: "media-v",
      startFrame: 0,
      durationFrames: 60,
      transform: { centerX: 0.75, centerY: 0.75, width: 1, height: 81.0 / 256.0, rotation: 0, flipHorizontal: false, flipVertical: false },
    });
    const timeline = makeTimeline([makeTrack([clip])], { width: 1080, height: 1920 });
    const withDefault = exportFcpxml(timeline, entries, { projectName: "Proj", startTimecodes: new Map() });
    const withExplicitResolve = exportFcpxml(timeline, entries, { projectName: "Proj", startTimecodes: new Map(), target: "resolve" });
    expect(withDefault).toBe(withExplicitResolve);
  });

  it("resolve target divides the imported position by the clip's per-axis conform-fit fraction", () => {
    // 16:9 source in a 9:16 sequence: fitH = 81/256, so centerY 0.75 → −25×256/81 = −79.0123;
    // x unaffected (fitW 1, since the source is wider than the frame).
    const entries = [videoEntry("media-v", { sourceWidth: 1280, sourceHeight: 720 })];
    const clip = makeClip({
      id: "clip-1",
      mediaRef: "media-v",
      startFrame: 0,
      durationFrames: 60,
      transform: { centerX: 0.75, centerY: 0.75, width: 1, height: 81.0 / 256.0, rotation: 0, flipHorizontal: false, flipVertical: false },
    });
    const timeline = makeTimeline([makeTrack([clip])], { width: 1080, height: 1920 });
    const xml = exportFcpxml(timeline, entries, { projectName: "Proj", startTimecodes: new Map() });

    expect(xml).toContain('<adjust-transform scale="1 1" anchor="0 0" position="14.0625 -79.0123"/>');
  });

  it("fcp target writes the spec-literal position and crop (no conform-fit division)", () => {
    const entries = [videoEntry("media-v", { sourceWidth: 1280, sourceHeight: 720 })];
    const clip = makeClip({
      id: "clip-1",
      mediaRef: "media-v",
      startFrame: 0,
      durationFrames: 60,
      transform: { centerX: 0.75, centerY: 0.75, width: 1, height: 81.0 / 256.0, rotation: 0, flipHorizontal: false, flipVertical: false },
      crop: { left: 0.2, top: 0.05, right: 0.1, bottom: 0.05 },
    });
    const timeline = makeTimeline([makeTrack([clip])], { width: 1080, height: 1920 });
    const xml = exportFcpxml(timeline, entries, { projectName: "Proj", startTimecodes: new Map(), target: "fcp" });

    expect(xml).toContain('position="14.0625 -25"');
    expect(xml).toContain('<trim-rect top="5" right="10" bottom="5" left="20"/>');
  });

  it("resolve target's trim-rect: left/right in source px ÷ (seqHeight/100), top/bottom ÷ conform-fit scale (fit=1 case)", () => {
    const entries = [videoEntry("media-v", { sourceWidth: 1920, sourceHeight: 1080 })];
    const clip = makeClip({
      id: "clip-1",
      mediaRef: "media-v",
      startFrame: 0,
      durationFrames: 60,
      crop: { left: 0.1, top: 0.2, right: 0.3, bottom: 0.4 },
    });
    const timeline = makeTimeline([makeTrack([clip])]);
    const xml = exportFcpxml(timeline, entries, { projectName: "Proj", startTimecodes: new Map() });

    expect(xml).toContain('<adjust-crop mode="trim">');
    expect(xml).toContain('<trim-rect top="20" right="53.3333" bottom="40" left="17.7778"/>');
  });

  it("resolve target's trim-rect for a wide source in a portrait sequence (fit≠1) matches DaVinci's own encoding", () => {
    // Byte-matches DaVinci's own export of the identical crop (256/128/36/36 source px).
    const entries = [videoEntry("media-v", { sourceWidth: 1280, sourceHeight: 720 })];
    const clip = makeClip({
      id: "clip-1",
      mediaRef: "media-v",
      startFrame: 0,
      durationFrames: 60,
      crop: { left: 0.2, top: 0.05, right: 0.1, bottom: 0.05 },
    });
    const timeline = makeTimeline([makeTrack([clip])], { width: 1080, height: 1920 });
    const xml = exportFcpxml(timeline, entries, { projectName: "Proj", startTimecodes: new Map() });

    expect(xml).toContain('<trim-rect top="5.9259" right="6.6667" bottom="5.9259" left="13.3333"/>');
  });
});

// --- Behavior not covered by a full-document golden ---

describe("exportFcpxml — clip resolution, lanes, and NTSC formats", () => {
  it("drops clips whose mediaRef has no manifest entry, and lottie clips unconditionally", () => {
    const videoClip = makeClip({ id: "vc", mediaRef: "media-v", startFrame: 0, durationFrames: 30 });
    const ghostClip = makeClip({ id: "ghost", mediaRef: "missing", startFrame: 0, durationFrames: 30 });
    const lottieClip = makeClip({ id: "lot", mediaRef: "media-v", mediaType: "lottie", startFrame: 0, durationFrames: 30 });
    const timeline = makeTimeline([makeTrack([videoClip, ghostClip, lottieClip])]);
    const xml = exportFcpxml(timeline, [videoEntry("media-v")], { projectName: "Proj", startTimecodes: new Map() });
    expect(xml).toContain('name="media-v.mp4"');
    expect(xml.match(/<asset-clip/g)).toHaveLength(1);
    expect(xml).not.toContain("<ref-clip");
    expect(xml).not.toContain("ghost");
  });

  it("drops a text clip with empty/missing textContent", () => {
    const emptyText = makeClip({ id: "empty", mediaRef: "text-1", mediaType: "text", startFrame: 0, durationFrames: 30, textContent: "" });
    const timeline = makeTimeline([makeTrack([emptyText])]);
    const xml = exportFcpxml(timeline, [], { projectName: "Proj", startTimecodes: new Map() });
    expect(xml).not.toContain("<title");
  });

  it("top-over-bottom track order maps to descending lane numbers; audio tracks get negative lanes", () => {
    const top = makeClip({ id: "top", mediaRef: "media-v", startFrame: 0, durationFrames: 30 });
    const bottom = makeClip({ id: "bottom", mediaRef: "media-v", startFrame: 0, durationFrames: 30 });
    const audio1 = makeClip({ id: "a1", mediaRef: "media-a", mediaType: "audio", startFrame: 0, durationFrames: 30 });
    const audio2 = makeClip({ id: "a2", mediaRef: "media-a", mediaType: "audio", startFrame: 30, durationFrames: 30 });
    const timeline = makeTimeline([
      makeTrack([top], "vt1", "video"),
      makeTrack([bottom], "vt2", "video"),
      makeTrack([audio1], "at1", "audio"),
      makeTrack([audio2], "at2", "audio"),
    ]);
    const xml = exportFcpxml(timeline, [videoEntry("media-v"), audioEntry("media-a")], { projectName: "Proj", startTimecodes: new Map() });
    // Top video track (declared first) is the top spatial layer -> highest lane number.
    expect(xml).toContain('lane="2"'); // top
    expect(xml).toContain('lane="1"'); // bottom
    expect(xml).toContain('lane="-1"'); // first audio track
    expect(xml).toContain('lane="-2"'); // second audio track
  });

  it("hidden video track / muted audio track emit enabled=0", () => {
    const videoClip = makeClip({ id: "vc", mediaRef: "media-v", startFrame: 0, durationFrames: 30 });
    const hiddenTrack: Track = { ...makeTrack([videoClip], "vt1", "video"), hidden: true };
    const xml = exportFcpxml(makeTimeline([hiddenTrack]), [videoEntry("media-v")], { projectName: "Proj", startTimecodes: new Map() });
    expect(xml).toContain('enabled="0"');
  });

  it("escapes special XML characters in a title's text content", () => {
    const clip = makeClip({
      id: "t1",
      mediaRef: "text-1",
      mediaType: "text",
      startFrame: 0,
      durationFrames: 30,
      textContent: `A & B < C`,
    });
    const xml = exportFcpxml(makeTimeline([makeTrack([clip])]), [], { projectName: "Proj", startTimecodes: new Map() });
    expect(xml).toContain("A &amp; B &lt; C");
    expect(xml).not.toContain("A & B <");
  });

  it("NTSC source fps (29.97) emits the 1001/30000s frameDuration and FCP's 2997 rate suffix", () => {
    const entries = [videoEntry("media-1", { sourceFPS: 30000 / 1001 })];
    const clip = makeClip({ id: "c1", mediaRef: "media-1", startFrame: 0, durationFrames: 30 });
    const xml = exportFcpxml(makeTimeline([makeTrack([clip])]), entries, { projectName: "Proj", startTimecodes: new Map() });
    expect(xml).toContain('frameDuration="1001/30000s"');
    expect(xml).toContain('name="FFVideoFormat1080p2997"');
  });

  it("speed=1 emits no timeMap; identity transform/crop/opacity/volume emit no adjust nodes", () => {
    const clip = makeClip({ id: "c1", mediaRef: "media-1", startFrame: 0, durationFrames: 30 });
    const xml = exportFcpxml(makeTimeline([makeTrack([clip])]), [videoEntry("media-1")], { projectName: "Proj", startTimecodes: new Map() });
    expect(xml).not.toContain("timeMap");
    expect(xml).not.toContain("adjust-crop");
    expect(xml).not.toContain("adjust-transform");
    expect(xml).not.toContain("adjust-blend");
    expect(xml).not.toContain("adjust-volume");
  });

  it("two mediaRefs resolving to the same physical file merge into one <asset> (FCPXML's physical-path dedupe)", () => {
    const entries = [
      videoEntry("media-1", { source: { kind: "external", absolutePath: "/Users/x/clip.mp4" } }),
      videoEntry("media-2", { source: { kind: "external", absolutePath: "/Users/x/clip.mp4" } }),
    ];
    const c1 = makeClip({ id: "c1", mediaRef: "media-1", startFrame: 0, durationFrames: 30 });
    const c2 = makeClip({ id: "c2", mediaRef: "media-2", startFrame: 30, durationFrames: 30 });
    const xml = exportFcpxml(makeTimeline([makeTrack([c1, c2])]), entries, { projectName: "Proj", startTimecodes: new Map() });
    expect(xml.match(/<asset /g)).toHaveLength(1);
    expect(xml.match(/<asset-clip/g)).toHaveLength(2);
  });
});
