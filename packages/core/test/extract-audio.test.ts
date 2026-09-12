import { describe, expect, test } from "vitest";
import {
  canExtractAudioFromEntry,
  extractAudioIntoManifest,
  extractedAudioName,
  type MediaManifestEntry,
} from "../src/index.js";

function videoEntry(over: Partial<MediaManifestEntry> = {}): MediaManifestEntry {
  return {
    id: "vid",
    name: "Interview",
    type: "video",
    source: { kind: "project", relativePath: "media/interview.mp4" },
    duration: 12.5,
    hasAudio: true,
    folderId: "b-roll",
    ...over,
  };
}

describe("extractAudioIntoManifest", () => {
  test("skips assets without extractable audio", () => {
    const silent = videoEntry({ id: "silent", hasAudio: false });
    const audio: MediaManifestEntry = {
      id: "take",
      name: "Take",
      type: "audio",
      source: { kind: "project", relativePath: "media/take.m4a" },
      duration: 4,
      hasAudio: true,
    };
    const image: MediaManifestEntry = {
      id: "still",
      name: "Still",
      type: "image",
      source: { kind: "project", relativePath: "media/still.png" },
      duration: 5,
    };
    const generating = videoEntry({ id: "gen", generationStatus: "generating" });
    expect(canExtractAudioFromEntry(silent)).toBe(false);
    expect(canExtractAudioFromEntry(audio)).toBe(false);
    expect(canExtractAudioFromEntry(image)).toBe(false);
    expect(canExtractAudioFromEntry(generating)).toBe(false);
    expect(extractAudioIntoManifest([silent], "silent", 1, () => "x")).toMatchObject({ error: expect.stringContaining("cannot extract") });
  });

  test("appends a new audio library asset; source video is unchanged", () => {
    const source = videoEntry();
    const snapshot = structuredClone(source);
    const out = extractAudioIntoManifest([source], "vid", 12.5, () => "aud-1");
    if ("error" in out) throw new Error(out.error);
    expect(out.extracted.type).toBe("audio");
    expect(out.extracted.name).toBe(extractedAudioName("Interview"));
    expect(out.extracted.duration).toBe(12.5);
    expect(out.extracted.folderId).toBe("b-roll");
    expect(out.extracted.id).toBe("aud-1");
    expect(out.entries).toHaveLength(2);
    expect(out.entries[0]).toEqual(snapshot);
    expect(out.entries[1]).toBe(out.extracted);
    expect(source).toEqual(snapshot);
  });
});
