import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { decodeProjectFiles, encodeProjectFiles, PROJECT_FILES, type ProjectDoc } from "../src/schema/serialize.js";
import { defaultTimeline } from "../src/timeline.js";
import { emptyMediaManifest } from "../src/media.js";
import { emptyGenerationLog } from "../src/generation-log.js";

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

  test("decodes a legacy macOS project (x/y transform, missing fields, no manifest)", () => {
    const doc = decodeProjectFiles({ timeline: legacy });
    const clip = doc.timeline.tracks[0]!.clips[0]!;
    expect(doc.timeline.fps).toBe(24);
    expect(clip.speed).toBe(1); // default filled
    expect(clip.transform.centerX).toBeCloseTo(0.5); // migrated from x
    expect(doc.manifest.entries).toEqual([]); // missing manifest → empty
  });
});
