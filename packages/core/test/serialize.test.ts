import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { decodeProjectFiles, encodeProjectFiles, PROJECT_FILES, type ProjectDoc } from "../src/schema/serialize.js";
import { defaultTimeline } from "../src/timeline.js";
import type { Track } from "../src/timeline.js";
import type { Clip } from "../src/clip.js";
import { defaultCrop, defaultTransform } from "../src/transform.js";
import { defaultTextStyle } from "../src/text-style.js";
import { emptyMediaManifest, type MediaManifestEntry } from "../src/media.js";
import { emptyGenerationLog } from "../src/generation-log.js";
import { createPlaceholderEntry, normalizeEntryForSave } from "../src/media/generation-status.js";

function makeTextClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: "text-1",
    mediaRef: "",
    mediaType: "text",
    sourceClipType: "text",
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
    transform: defaultTransform(),
    crop: defaultCrop(),
    textContent: "Hello brave world",
    textStyle: defaultTextStyle(),
    ...overrides,
  };
}

const legacy = readFileSync(fileURLToPath(new URL("./fixtures/legacy-project.json", import.meta.url)), "utf8");

describe("serialize", () => {
  test("round-trips a project doc", () => {
    const doc: ProjectDoc = {
      timeline: { ...defaultTimeline(), fps: 25 },
      manifest: emptyMediaManifest(),
      generationLog: emptyGenerationLog(),
    };
    const files = encodeProjectFiles(doc);
    const back = decodeProjectFiles({
      timeline: files[PROJECT_FILES.timeline]!,
      manifest: files[PROJECT_FILES.manifest]!,
      generationLog: files[PROJECT_FILES.generationLog]!,
    });
    expect(back.timeline.fps).toBe(25);
  });

  test("a generation placeholder entry survives the encode→decode round trip", () => {
    // Regression: a partial GenerationInput used to fail schema-parse on reload, and the
    // corrupt-manifest degrade path then wiped EVERY entry — not just the placeholder.
    const placeholder = createPlaceholderEntry({
      id: "abcdef1234567890", type: "video", name: "Gen", duration: 5, ext: "mp4",
      genInput: { prompt: "a cat", model: "veo3.1-fast", duration: 5, aspectRatio: "16:9", backendJobId: "job-1" },
    });
    const plain: MediaManifestEntry = {
      id: "other", name: "clip.mp4", type: "video", duration: 3,
      source: { kind: "project", relativePath: "media/clip.mp4" },
    };
    const doc: ProjectDoc = {
      timeline: defaultTimeline(),
      manifest: { ...emptyMediaManifest(), entries: [normalizeEntryForSave({ ...placeholder, generationStatus: "generating" }), plain] },
      generationLog: emptyGenerationLog(),
    };
    const files = encodeProjectFiles(doc);
    const back = decodeProjectFiles({
      timeline: files[PROJECT_FILES.timeline]!,
      manifest: files[PROJECT_FILES.manifest]!,
      generationLog: files[PROJECT_FILES.generationLog]!,
    });
    expect(back.manifestUnreadable).toBe(false); // NOT the corrupt-wipe path
    expect(back.manifest.entries).toHaveLength(2);
    expect(back.manifest.entries[0]!.generationStatus).toBe("generating");
    expect(back.manifest.entries[0]!.generationInput?.backendJobId).toBe("job-1");
  });

  test("a manifest entry with transcriptPath + embeddingPath + a transcribing status survives the encode→decode round trip", () => {
    const entry: MediaManifestEntry = {
      id: "abc", name: "clip.mp4", type: "video", duration: 3,
      source: { kind: "project", relativePath: "media/abc.mp4" },
      transcriptPath: "media/abc.transcript.json",
      embeddingPath: "media/abc.embed",
      generationStatus: "transcribing",
    };
    const doc: ProjectDoc = {
      timeline: defaultTimeline(),
      manifest: { ...emptyMediaManifest(), entries: [entry] },
      generationLog: emptyGenerationLog(),
    };
    const files = encodeProjectFiles(doc);
    const back = decodeProjectFiles({
      timeline: files[PROJECT_FILES.timeline]!,
      manifest: files[PROJECT_FILES.manifest]!,
      generationLog: files[PROJECT_FILES.generationLog]!,
    });
    expect(back.manifestUnreadable).toBe(false);
    expect(back.manifest.entries).toHaveLength(1);
    expect(back.manifest.entries[0]!.transcriptPath).toBe("media/abc.transcript.json");
    expect(back.manifest.entries[0]!.embeddingPath).toBe("media/abc.embed");
    expect(back.manifest.entries[0]!.generationStatus).toBe("transcribing"); // persisted: not preparing/none
  });

  test("an old-shape manifest entry (no generation fields) still parses", () => {
    const manifest = JSON.stringify({
      version: 2,
      entries: [{ id: "a", name: "a.mp4", type: "video", duration: 2, source: { kind: "project", relativePath: "media/a.mp4" } }],
      folders: [],
    });
    const files = encodeProjectFiles({ timeline: defaultTimeline(), manifest: emptyMediaManifest(), generationLog: emptyGenerationLog() });
    const back = decodeProjectFiles({ timeline: files[PROJECT_FILES.timeline]!, manifest });
    expect(back.manifestUnreadable).toBe(false);
    expect(back.manifest.entries).toHaveLength(1);
    expect(back.manifest.entries[0]!.generationStatus).toBeUndefined();
  });

  test("a text clip carrying textAnimation + wordTimings survives the encode->decode round trip", () => {
    const clip = makeTextClip({
      textAnimation: { preset: "highlightPop", highlightColor: { r: 1, g: 0.85, b: 0, a: 1 } },
      wordTimings: [
        { text: "Hello", startFrame: 0, endFrame: 10 },
        { text: "brave", startFrame: 10, endFrame: 20 },
        { text: "world", startFrame: 20, endFrame: 30 },
      ],
    });
    const track: Track = { id: "t1", type: "text", muted: false, hidden: false, syncLocked: true, clips: [clip] };
    const doc: ProjectDoc = {
      timeline: { ...defaultTimeline(), tracks: [track] },
      manifest: emptyMediaManifest(),
      generationLog: emptyGenerationLog(),
    };
    const files = encodeProjectFiles(doc);
    const back = decodeProjectFiles({
      timeline: files[PROJECT_FILES.timeline]!,
      manifest: files[PROJECT_FILES.manifest]!,
      generationLog: files[PROJECT_FILES.generationLog]!,
    });
    const backClip = back.timeline.tracks[0]!.clips[0]!;
    expect(backClip.textAnimation).toEqual({ preset: "highlightPop", highlightColor: { r: 1, g: 0.85, b: 0, a: 1 } });
    expect(backClip.wordTimings).toEqual(clip.wordTimings);
  });

  test("a clip without textAnimation/wordTimings (old project shape) still decodes with both fields undefined", () => {
    const clip = makeTextClip();
    const track: Track = { id: "t1", type: "text", muted: false, hidden: false, syncLocked: true, clips: [clip] };
    const doc: ProjectDoc = {
      timeline: { ...defaultTimeline(), tracks: [track] },
      manifest: emptyMediaManifest(),
      generationLog: emptyGenerationLog(),
    };
    const files = encodeProjectFiles(doc);
    const back = decodeProjectFiles({ timeline: files[PROJECT_FILES.timeline]! });
    const backClip = back.timeline.tracks[0]!.clips[0]!;
    expect(backClip.textAnimation).toBeUndefined();
    expect(backClip.wordTimings).toBeUndefined();
  });

  test("decodes a legacy macOS project (x/y transform, missing fields, no manifest)", () => {
    const doc = decodeProjectFiles({ timeline: legacy });
    const clip = doc.timeline.tracks[0]!.clips[0]!;
    expect(doc.timeline.fps).toBe(24);
    expect(clip.speed).toBe(1); // default filled
    expect(clip.transform.centerX).toBeCloseTo(0.5); // migrated from x
    expect(doc.manifest.entries).toEqual([]); // missing manifest → empty
    expect(doc.manifestUnreadable).toBe(false); // missing != corrupt
  });

  test("corrupt media.json (invalid JSON) degrades to an empty manifest, flagged unreadable", () => {
    const files = encodeProjectFiles({ timeline: defaultTimeline(), manifest: emptyMediaManifest(), generationLog: emptyGenerationLog() });
    const doc = decodeProjectFiles({ timeline: files[PROJECT_FILES.timeline]!, manifest: "{ this is not valid json" });
    expect(doc.manifest.entries).toEqual([]);
    expect(doc.manifest.folders).toEqual([]);
    expect(doc.manifestUnreadable).toBe(true);
    expect(doc.timeline.fps).toBe(defaultTimeline().fps); // timeline still decodes fine
  });

  test("0-byte media.json (truncated write) is corrupt, not missing", () => {
    const files = encodeProjectFiles({ timeline: defaultTimeline(), manifest: emptyMediaManifest(), generationLog: emptyGenerationLog() });
    const doc = decodeProjectFiles({ timeline: files[PROJECT_FILES.timeline]!, manifest: "" });
    expect(doc.manifest.entries).toEqual([]);
    expect(doc.manifestUnreadable).toBe(true); // the file existed but is unreadable
  });

  test("valid-JSON-wrong-shape media.json degrades the same way", () => {
    const files = encodeProjectFiles({ timeline: defaultTimeline(), manifest: emptyMediaManifest(), generationLog: emptyGenerationLog() });
    const doc = decodeProjectFiles({
      timeline: files[PROJECT_FILES.timeline]!,
      manifest: JSON.stringify({ entries: "not-an-array" }),
    });
    expect(doc.manifest.entries).toEqual([]);
    expect(doc.manifestUnreadable).toBe(true);
  });

  test("corrupt generation-log degrades to an empty log; project still opens", () => {
    const files = encodeProjectFiles({ timeline: defaultTimeline(), manifest: emptyMediaManifest(), generationLog: emptyGenerationLog() });
    const doc = decodeProjectFiles({ timeline: files[PROJECT_FILES.timeline]!, generationLog: "{ this is not valid json" });
    expect(doc.generationLog.entries).toEqual([]);
    expect(doc.manifestUnreadable).toBe(false); // unrelated to the manifest flag
  });
});
