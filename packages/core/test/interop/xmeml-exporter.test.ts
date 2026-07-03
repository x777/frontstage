import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { exportXmeml } from "../../src/interop/xmeml-exporter.js";
import type { Clip } from "../../src/clip.js";
import type { Track, Timeline } from "../../src/timeline.js";
import type { MediaManifestEntry } from "../../src/media.js";
import type { SourceTimecode } from "../../src/interop/source-timecode.js";

// --- Fixtures ---
// Golden .xml files under __fixtures__ were generated from this exporter and hand-verified line by
// line against Swift's Export/XMLExporter.swift rules (NTSC/timebase math, keyframe `when`/`value`
// formatting, dB→linear volume, drop-frame SMPTE formatting, fade cutPointTicks, #247 relink/tc — see
// the task report for the full numeric trace). They pin regressions from here on.

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
  return readFileSync(new URL(`./__fixtures__/${name}.xml`, import.meta.url), "utf-8");
}

// --- Goldens ---

describe("exportXmeml — goldens", () => {
  it("minimal 1-clip video export: header, sequence shell, single clipitem", () => {
    const entries = [videoEntry("media-1", { name: "MyVideo" })];
    const clip = makeClip({ id: "clip-1", mediaRef: "media-1", startFrame: 30, durationFrames: 60 });
    const timeline = makeTimeline([makeTrack([clip])]);
    const xml = exportXmeml(timeline, entries, { projectName: "Proj", startTimecodes: new Map() });
    expect(xml).toBe(fixture("minimal"));
  });

  it("multi-track + linked A/V: reversed video order, reciprocal <link>, collapsed repeat <file>", () => {
    const entries = [videoEntry("media-v", { name: "v" }), audioEntry("media-a", { name: "a" })];
    const videoClip = makeClip({ id: "vc", mediaRef: "media-v", mediaType: "video", startFrame: 0, durationFrames: 30, linkGroupId: "g1" });
    const audioClip = makeClip({ id: "ac", mediaRef: "media-a", mediaType: "audio", startFrame: 0, durationFrames: 30, linkGroupId: "g1" });
    const topClip = makeClip({ id: "top", mediaRef: "media-v", startFrame: 0, durationFrames: 30 });
    // Model order: top video track declared first, linked video track second — FCP wants bottom→top,
    // so the linked track (declared last) must appear FIRST in the XML.
    const timeline = makeTimeline([
      makeTrack([topClip], "vt1", "video"),
      makeTrack([videoClip], "vt2", "video"),
      makeTrack([audioClip], "at1", "audio"),
    ]);
    const xml = exportXmeml(timeline, entries, { projectName: "Proj", startTimecodes: new Map() });
    expect(xml).toBe(fixture("multitrack-linked"));
  });

  it("retime (speed=2, trim=10) + keyframed scale/rotation/opacity/crop", () => {
    const entries = [videoEntry("media-1", { name: "Clip", sourceWidth: 3840, sourceHeight: 2160 })];
    const clip = makeClip({
      id: "c1",
      mediaRef: "media-1",
      startFrame: 0,
      durationFrames: 200,
      trimStartFrame: 10,
      speed: 2.0,
      opacityTrack: {
        keyframes: [
          { frame: 30, value: 1.0, interpolationOut: "linear" },
          { frame: 150, value: 0.5, interpolationOut: "linear" },
        ],
      },
      cropTrack: {
        keyframes: [
          { frame: 0, value: { left: 0, top: 0, right: 0, bottom: 0 }, interpolationOut: "linear" },
          { frame: 60, value: { left: 0.5, top: 0, right: 0, bottom: 0 }, interpolationOut: "linear" },
        ],
      },
      scaleTrack: {
        keyframes: [
          { frame: 0, value: { a: 0.5, b: 0.5 }, interpolationOut: "linear" },
          { frame: 100, value: { a: 1, b: 1 }, interpolationOut: "linear" },
        ],
      },
    });
    const timeline = makeTimeline([makeTrack([clip])]);
    const xml = exportXmeml(timeline, entries, { projectName: "Proj", startTimecodes: new Map() });
    expect(xml).toBe(fixture("retime-keyframes"));
    // Pin the two numeric rules that are easy to get backwards:
    // in/out are source-frame offsets spanning sourceFramesConsumed, not the retimed timeline span.
    expect(xml).toContain("<in>10</in>");
    expect(xml).toContain("<out>410</out>"); // trimStart(10) + round(durationFrames(200) * speed(2))
    expect(xml).toContain("<value>200.0000</value>"); // Time Remap speed% = speed * 100, 4dp
  });

  it("keyframed volume on an audio clip: dB keyframes convert to linear gain (linearFromDb)", () => {
    const entries = [audioEntry("media-a", { name: "a" })];
    const clip = makeClip({
      id: "ac",
      mediaRef: "media-a",
      mediaType: "audio",
      startFrame: 0,
      durationFrames: 100,
      volumeTrack: {
        keyframes: [
          { frame: 0, value: 0, interpolationOut: "linear" },
          { frame: 50, value: -6, interpolationOut: "linear" },
        ],
      },
    });
    const timeline = makeTimeline([makeTrack([clip], "at1", "audio")]);
    const xml = exportXmeml(timeline, entries, { projectName: "Proj", startTimecodes: new Map() });
    expect(xml).toBe(fixture("volume-keyframes-audio"));
    // 0dB -> linear 1.0; -6dB -> 10^(-6/20) = 0.501187... -> "0.5012" (4dp, clamped to [0, 3.98]).
    expect(xml).toContain("<value>1.0000</value>");
    expect(xml).toContain("<value>0.5012</value>");
  });

  it("fade in/out emit single-sided Cross Dissolve transitions ahead of/after the clipitem", () => {
    const entries = [videoEntry("media-1", { name: "Clip" })];
    const clip = makeClip({ id: "c1", mediaRef: "media-1", startFrame: 100, durationFrames: 200, fadeInFrames: 30, fadeOutFrames: 20 });
    const timeline = makeTimeline([makeTrack([clip])]);
    const xml = exportXmeml(timeline, entries, { projectName: "Proj", startTimecodes: new Map() });
    expect(xml).toBe(fixture("fades"));
    // cutPointTicks = cutFrames * trunc(254016000000 / fps); fade-out cutFrames = fadeOutFrames.
    expect(xml).toContain("<cutPointTicks>169344000000</cutPointTicks>");
  });
});

// --- Source timecode (#247) ---

describe("exportXmeml — source timecode (#247)", () => {
  const entries = [videoEntry("media-1", { name: "Clip" })];
  const clip = makeClip({ id: "c1", mediaRef: "media-1", startFrame: 0, durationFrames: 30 });
  const timeline = makeTimeline([makeTrack([clip])]);
  const tc: SourceTimecode = { frame: 42966, quanta: 30, dropFrame: true }; // Fuji 59.94p-style 30 DF tmcd

  it("absent timecode falls back to the 0-based dummy tc (00:00:00:00, NDF)", () => {
    const xml = exportXmeml(timeline, entries, { projectName: "Proj", startTimecodes: new Map() });
    expect(xml).toBe(fixture("tc-absent"));
  });

  it("present timecode changes ONLY the file's <timecode> block — clip start/end/in/out stay 0-based", () => {
    const xml = exportXmeml(timeline, entries, { projectName: "Proj", startTimecodes: new Map([["media-1", tc]]) });
    expect(xml).toBe(fixture("tc-present"));

    const absentLines = fixture("tc-absent").split("\n");
    const presentLines = xml.split("\n");
    expect(presentLines).toHaveLength(absentLines.length);
    const changed = presentLines.filter((line, i) => line !== absentLines[i]);
    // Exactly the 4 lines inside <file><timecode>: <rate><ntsc>, <string>, <frame>, <displayformat>.
    expect(changed).toEqual([
      "                  <ntsc>TRUE</ntsc>",
      "                <string>00;23;53;18</string>",
      "                <frame>42966</frame>",
      "                <displayformat>DF</displayformat>",
    ]);
    // Spine/clipitem placement is untouched by source timecode (XMEML has no #247 "inner clip" — only FCPXML does).
    expect(xml).toContain("<start>0</start>");
    expect(xml).toContain("<end>30</end>");
    expect(xml).toContain("<in>0</in>");
    expect(xml).toContain("<out>30</out>");
  });

  it("an unrelated mediaRef in startTimecodes does not affect output (absent ⇒ byte-identical)", () => {
    const unrelated = new Map([["some-other-media", tc]]);
    const xml = exportXmeml(timeline, entries, { projectName: "Proj", startTimecodes: unrelated });
    expect(xml).toBe(fixture("tc-absent"));
  });
});

// --- Behavior not covered by a full-document golden ---

describe("exportXmeml — clip resolution and track flags", () => {
  it("drops clips whose mediaRef has no manifest entry (unresolvable, or a text clip with no media)", () => {
    const videoClip = makeClip({ id: "vc", mediaRef: "media-v", startFrame: 0, durationFrames: 30 });
    const textClip = makeClip({ id: "tc", mediaRef: "text-no-manifest", mediaType: "text", startFrame: 0, durationFrames: 30 });
    const timeline = makeTimeline([makeTrack([videoClip, textClip])]);
    const xml = exportXmeml(timeline, [videoEntry("media-v")], { projectName: "Proj", startTimecodes: new Map() });
    expect(xml).not.toContain("clipitem-tc");
    expect(xml).toContain("clipitem-vc");
  });

  it("sorts multiple clips on the same track by startFrame regardless of array order", () => {
    const later = makeClip({ id: "later", mediaRef: "media-v", startFrame: 100, durationFrames: 30 });
    const earlier = makeClip({ id: "earlier", mediaRef: "media-v", startFrame: 0, durationFrames: 30 });
    const timeline = makeTimeline([makeTrack([later, earlier])]);
    const xml = exportXmeml(timeline, [videoEntry("media-v")], { projectName: "Proj", startTimecodes: new Map() });
    expect(xml.indexOf("clipitem-earlier")).toBeLessThan(xml.indexOf("clipitem-later"));
  });

  it("muted audio track / hidden video track emit <enabled>FALSE</enabled>", () => {
    const audioClip = makeClip({ id: "ac", mediaRef: "media-a", mediaType: "audio", startFrame: 0, durationFrames: 30 });
    const audioTrack: Track = { ...makeTrack([audioClip], "at1", "audio"), muted: true };
    const xml = exportXmeml(makeTimeline([audioTrack]), [audioEntry("media-a")], { projectName: "Proj", startTimecodes: new Map() });
    expect(xml).toContain("<enabled>FALSE</enabled>");
  });

  it("escapes special XML characters in the clip's display name", () => {
    const entries = [videoEntry("media-v", { name: `A & B < C > "D" 'E'` })];
    const clip = makeClip({ id: "c1", mediaRef: "media-v", startFrame: 0, durationFrames: 30 });
    const xml = exportXmeml(makeTimeline([makeTrack([clip])]), entries, { projectName: "Proj", startTimecodes: new Map() });
    expect(xml).toContain("A &amp; B &lt; C &gt; &quot;D&quot; &apos;E&apos;");
    expect(xml).not.toContain(`A & B <`);
  });

  it("NTSC source fps (29.97) marks the file rate ntsc TRUE while the sequence stays FALSE", () => {
    const entries = [videoEntry("media-1", { sourceFPS: 30000 / 1001 })];
    const clip = makeClip({ id: "c1", mediaRef: "media-1", startFrame: 0, durationFrames: 30 });
    const xml = exportXmeml(makeTimeline([makeTrack([clip])]), entries, { projectName: "Proj", startTimecodes: new Map() });
    const ntscValues = [...xml.matchAll(/<ntsc>(TRUE|FALSE)<\/ntsc>/g)].map((m) => m[1]);
    expect(ntscValues[0]).toBe("FALSE"); // sequence rate
    expect(ntscValues).toContain("TRUE"); // the source file's own rate
  });

  it("speed=1 emits no Time Remap filter; volume=1/opacity=1/identity transform+crop emit no filters", () => {
    const clip = makeClip({ id: "c1", mediaRef: "media-1", startFrame: 0, durationFrames: 30 });
    const xml = exportXmeml(makeTimeline([makeTrack([clip])]), [videoEntry("media-1")], { projectName: "Proj", startTimecodes: new Map() });
    expect(xml).not.toContain("timeremap");
    expect(xml).not.toContain("<effectid>basic</effectid>");
    expect(xml).not.toContain("<effectid>crop</effectid>");
    expect(xml).not.toContain("<effectid>opacity</effectid>");
    expect(xml).not.toContain("<transitionitem>");
  });
});
