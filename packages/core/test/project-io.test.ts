import { describe, expect, test } from "vitest";
import { MemoryProjectStore } from "../src/project/memory-store.js";
import { readProject, writeProject } from "../src/project/project-io.js";
import { defaultTimeline } from "../src/timeline.js";
import { emptyMediaManifest } from "../src/media.js";
import { emptyGenerationLog } from "../src/generation-log.js";

describe("project IO", () => {
  test("writes then reads a project through a store", async () => {
    const store = new MemoryProjectStore();
    await writeProject(store, {
      timeline: { ...defaultTimeline(), fps: 50, tracks: [] },
      manifest: emptyMediaManifest(),
      generationLog: emptyGenerationLog(),
    });
    const doc = await readProject(store);
    expect(doc.timeline.fps).toBe(50);
    expect(store.snapshot().has("project.json")).toBe(true);
  });

  test("reading a store missing project.json throws", async () => {
    await expect(readProject(new MemoryProjectStore())).rejects.toThrow();
  });
});
