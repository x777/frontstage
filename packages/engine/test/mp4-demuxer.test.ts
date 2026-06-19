import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { demuxMp4 } from "../src/demux/mp4-demuxer.js";

const bytes = readFileSync(fileURLToPath(new URL("./fixtures/clip.mp4", import.meta.url)));
const blob = new Blob([bytes], { type: "video/mp4" });

describe("demuxMp4", () => {
  test("extracts the H.264 video track with a keyframe-led sample table", async () => {
    const r = await demuxMp4(blob);
    expect(r.video).toBeDefined();
    expect(r.video!.codec.startsWith("avc1")).toBe(true);
    expect(r.video!.codedWidth).toBe(320);
    expect(r.video!.codedHeight).toBe(240);
    expect(r.video!.samples.length).toBeGreaterThan(0);
    expect(r.video!.samples[0]!.isSync).toBe(true);
    expect(r.video!.description).toBeInstanceOf(Uint8Array);
    expect((r.video!.description as Uint8Array).byteLength).toBeGreaterThan(0);
  });
  test("extracts the AAC audio track with esds description", async () => {
    const r = await demuxMp4(blob);
    expect(r.audio).toBeDefined();
    expect(r.audio!.codec.startsWith("mp4a")).toBe(true);
    expect(r.audio!.sampleRate).toBeGreaterThan(0);
    expect(r.audio!.samples.length).toBeGreaterThan(0);
    expect(r.audio!.description).toBeInstanceOf(Uint8Array);
    expect((r.audio!.description as Uint8Array).byteLength).toBeGreaterThan(0);
  });
});
