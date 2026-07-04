import { describe, expect, test } from "vitest";
import { planAgentResolutionAdoption } from "../src/editor/settings-commands.js";
import { defaultTimeline } from "../src/timeline.js";
import { defaultTransform, defaultCrop } from "../src/transform.js";
import type { MediaManifest, MediaManifestEntry } from "../src/media.js";
import type { Timeline, Track } from "../src/timeline.js";

function track(id: string, clips: Track["clips"] = []): Track {
  return { id, type: "video", muted: false, hidden: false, syncLocked: false, clips };
}

function videoAsset(over: Partial<MediaManifestEntry> = {}): MediaManifestEntry {
  return {
    id: "a",
    name: "a.mp4",
    type: "video",
    source: { kind: "external", absolutePath: "/tmp/a.mp4" },
    duration: 2,
    ...over,
  };
}

function manifestOf(...entries: MediaManifestEntry[]): MediaManifest {
  return { version: 2, entries, folders: [] };
}

const clip = {
  id: "c1",
  mediaRef: "a",
  mediaType: "video" as const,
  sourceClipType: "video" as const,
  startFrame: 0,
  durationFrames: 60,
  trimStartFrame: 0,
  trimEndFrame: 0,
  speed: 1,
  volume: 1,
  fadeInFrames: 0,
  fadeOutFrames: 0,
  fadeInInterpolation: "linear" as const,
  fadeOutInterpolation: "linear" as const,
  opacity: 1,
  transform: defaultTransform(),
  crop: defaultCrop(),
};

describe("planAgentResolutionAdoption", () => {
  test("unconfigured timeline: adopts the first video asset's resolution, fps untouched, settingsConfigured flips true", () => {
    const tl: Timeline = { ...defaultTimeline(), tracks: [track("t1")] }; // settingsConfigured: false
    const manifest = manifestOf(videoAsset({ sourceWidth: 3840, sourceHeight: 2160, sourceFPS: 24 }));
    const plan = planAgentResolutionAdoption(tl, manifest, [manifest.entries[0]!]);

    expect(plan.command).not.toBeNull();
    const next = plan.command!.apply(tl);
    expect(next.width).toBe(3840);
    expect(next.height).toBe(2160);
    expect(next.fps).toBe(30); // NEVER adopted (#233 standing rule)
    expect(next.settingsConfigured).toBe(true);
    expect(plan.note).toContain("Set timeline to 3840×2160 to match clip.");
    expect(plan.note).toContain("Clip is 24fps but project is 30fps");
  });

  test("unconfigured timeline whose resolution already matches: still applies (flips settingsConfigured) but no resolution note", () => {
    const tl: Timeline = { ...defaultTimeline(), tracks: [track("t1")] };
    const manifest = manifestOf(videoAsset({ sourceWidth: 1920, sourceHeight: 1080 }));
    const plan = planAgentResolutionAdoption(tl, manifest, [manifest.entries[0]!]);

    expect(plan.command).not.toBeNull();
    const next = plan.command!.apply(tl);
    expect(next.settingsConfigured).toBe(true);
    expect(next.width).toBe(1920);
    expect(next.height).toBe(1080);
    expect(plan.note).toBeNull(); // no fps in this asset, resolution already matched
  });

  test("configured timeline with existing clips: never touched, regardless of resolution mismatch", () => {
    const tl: Timeline = { ...defaultTimeline(), settingsConfigured: true, tracks: [track("t1", [clip])] };
    const manifest = manifestOf(videoAsset({ sourceWidth: 3840, sourceHeight: 2160 }));
    const plan = planAgentResolutionAdoption(tl, manifest, [manifest.entries[0]!]);

    expect(plan.command).toBeNull();
    expect(plan.note).toBeNull();
  });

  test("configured timeline that's been emptied: mismatch resolution adopts + note describes a match, not a fresh detect", () => {
    const tl: Timeline = { ...defaultTimeline(), settingsConfigured: true, tracks: [track("t1", [])] };
    const manifest = manifestOf(videoAsset({ sourceWidth: 3840, sourceHeight: 2160 }));
    const plan = planAgentResolutionAdoption(tl, manifest, [manifest.entries[0]!]);

    expect(plan.command).not.toBeNull();
    const next = plan.command!.apply(tl);
    expect(next.width).toBe(3840);
    expect(next.height).toBe(2160);
    expect(plan.note).toBe("Matched timeline resolution to clip: 3840×2160.");
  });

  test("configured + emptied timeline whose resolution already matches: no-op, no note", () => {
    const tl: Timeline = { ...defaultTimeline(), settingsConfigured: true, tracks: [track("t1", [])] };
    const manifest = manifestOf(videoAsset({ sourceWidth: 1920, sourceHeight: 1080 }));
    const plan = planAgentResolutionAdoption(tl, manifest, [manifest.entries[0]!]);

    expect(plan.command).toBeNull();
    expect(plan.note).toBeNull();
  });

  test("no video asset among orderedAssets (e.g. audio-only): no-op entirely, even on an unconfigured timeline", () => {
    const tl: Timeline = { ...defaultTimeline(), tracks: [track("t1")] };
    const audio: MediaManifestEntry = {
      id: "b", name: "b.mp3", type: "audio", source: { kind: "external", absolutePath: "/tmp/b.mp3" }, duration: 3,
    };
    const manifest = manifestOf(audio);
    const plan = planAgentResolutionAdoption(tl, manifest, [audio]);

    expect(plan.command).toBeNull();
    expect(plan.note).toBeNull();
  });

  test("orderedAssets order matters: picks the FIRST video, skipping a leading audio asset", () => {
    const tl: Timeline = { ...defaultTimeline(), tracks: [track("t1")] };
    const audio: MediaManifestEntry = {
      id: "b", name: "b.mp3", type: "audio", source: { kind: "external", absolutePath: "/tmp/b.mp3" }, duration: 3,
    };
    const video1 = videoAsset({ id: "v1", sourceWidth: 640, sourceHeight: 480 });
    const video2 = videoAsset({ id: "v2", sourceWidth: 3840, sourceHeight: 2160 });
    const manifest = manifestOf(audio, video1, video2);
    const plan = planAgentResolutionAdoption(tl, manifest, [audio, video1, video2]);

    const next = plan.command!.apply(tl);
    expect(next.width).toBe(640);
    expect(next.height).toBe(480);
  });

  test("no even-rounding: odd source dimensions pass through verbatim (Swift's checkProjectSettings does not round)", () => {
    const tl: Timeline = { ...defaultTimeline(), tracks: [track("t1")] };
    const manifest = manifestOf(videoAsset({ sourceWidth: 1921, sourceHeight: 1081 }));
    const plan = planAgentResolutionAdoption(tl, manifest, [manifest.entries[0]!]);

    const next = plan.command!.apply(tl);
    expect(next.width).toBe(1921);
    expect(next.height).toBe(1081);
  });
});
