import { describe, expect, test } from "vitest";
import {
  EditorStore,
  defaultTimeline,
  extractedAudioName,
  type MediaManifest,
  type MediaManifestEntry,
} from "@frontstage/core";
import { extractAudioTool } from "../src/tools/extract-audio-tool.js";
import type { ToolContext } from "../src/index.js";

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

function textOf(result: { blocks: { kind: string; text?: string }[] }): string {
  const block = result.blocks[0];
  return block?.kind === "text" ? (block.text ?? "") : "";
}

describe("extract_audio tool", () => {
  test("adds a new audio library asset; source video is unmodified", async () => {
    const source = videoEntry();
    const entries: MediaManifestEntry[] = [source];
    const sourceSnapshot = structuredClone(source);
    const soundtrackDuration = 12.5;
    const wav = new Uint8Array([1, 2, 3, 4]);

    const ctx: ToolContext = {
      store: new EditorStore(defaultTimeline()),
      getManifest: (): MediaManifest => ({ version: 2, entries, folders: [] }),
      newId: () => "aud-1",
      extractAudio: {
        extract: async (mediaRef) => {
          expect(mediaRef).toBe("vid");
          return { bytes: wav, durationSeconds: soundtrackDuration };
        },
      },
      mediaImport: {
        fromBytes: async (bytes, mime, name, folderId) => {
          expect(bytes).toEqual(wav);
          expect(mime).toBe("audio/wav");
          expect(name).toBe(extractedAudioName("Interview"));
          expect(folderId).toBe("b-roll");
          const added: MediaManifestEntry = {
            id: "aud-1",
            name: name ?? "extracted",
            type: "audio",
            source: { kind: "project", relativePath: "media/extracted-aud-1.wav" },
            duration: soundtrackDuration,
            folderId,
            hasAudio: true,
          };
          entries.push(added);
          return { assetId: "aud-1" };
        },
        fromUrl: async () => ({ assetId: "nope" }),
      },
    };

    const result = await extractAudioTool().run({ mediaRef: "vid" }, ctx);
    expect(result.isError).toBe(false);
    const out = JSON.parse(textOf(result));
    expect(out.type).toBe("audio");
    expect(out.durationSeconds).toBe(soundtrackDuration);
    expect(out.mediaRef).toBe("aud-1");
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual(sourceSnapshot);
    expect(entries[1]!.type).toBe("audio");
    expect(entries[1]!.duration).toBe(soundtrackDuration);
  });

  test("skips video without audio", async () => {
    const entries = [videoEntry({ hasAudio: false })];
    const ctx: ToolContext = {
      store: new EditorStore(defaultTimeline()),
      getManifest: () => ({ version: 2, entries, folders: [] }),
      newId: () => "x",
    };
    const result = await extractAudioTool().run({ mediaRef: "vid" }, ctx);
    expect(result.isError).toBe(true);
    expect(entries).toHaveLength(1);
  });
});
