import { describe, expect, test } from "vitest";
import { MemoryProjectStore } from "../src/project/memory-store.js";
import { readProject, writeProject } from "../src/project/project-io.js";
import { PROJECT_FILES } from "../src/schema/serialize.js";
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

  test("readProject degrades a corrupt media.json instead of throwing, and keeps the raw text", async () => {
    const store = new MemoryProjectStore();
    await writeProject(store, {
      timeline: defaultTimeline(),
      manifest: emptyMediaManifest(),
      generationLog: emptyGenerationLog(),
    });
    const corrupt = "{ this is not valid json";
    await store.writeText(PROJECT_FILES.manifest, corrupt);

    const doc = await readProject(store);

    expect(doc.manifest.entries).toEqual([]);
    expect(doc.manifestUnreadable).toBe(true);
    expect(doc.rawManifestText).toBe(corrupt);
  });

  test("readProject with a valid manifest is not flagged unreadable", async () => {
    const store = new MemoryProjectStore();
    await writeProject(store, {
      timeline: defaultTimeline(),
      manifest: emptyMediaManifest(),
      generationLog: emptyGenerationLog(),
    });

    const doc = await readProject(store);

    expect(doc.manifestUnreadable).toBe(false);
    expect(doc.rawManifestText).not.toBeNull();
  });
});
