import { EditorStore, defaultTimeline } from "@frontstage/core";
import type { MediaManifest, MediaManifestEntry, MediaGateway, ProjectGateway, BoundProject, ProjectRef } from "@frontstage/core";
import type { EditorMediaHost } from "../src/editor/editor-host.js";
import { createEditorHost } from "../src/editor/editor-host.js";

function makeMediaHost(): EditorMediaHost {
  let manifest: MediaManifest = { version: 2, entries: [], folders: [] };
  return {
    getManifest: () => manifest,
    loadManifest: (m) => { manifest = m; },
    pendingMedia: () => new Map(),
    markMediaPersisted: () => {},
    setGateway: () => {},
  };
}

function makeGateway(): ProjectGateway {
  return {
    pickOpen: async () => null,
    pickSaveAs: async () => null,
    bind: async (_ref: ProjectRef): Promise<BoundProject> => {
      throw new Error("not implemented");
    },
    listRecent: async () => [],
    addRecent: async () => {},
    removeRecent: async () => {},
  };
}

test("createEditorHost: getGenerationLog returns empty initially", () => {
  const store = new EditorStore(defaultTimeline());
  const { host } = createEditorHost(store, makeMediaHost(), makeGateway());
  const log = host.getGenerationLog();
  expect(log.version).toBe(1);
  expect(log.entries).toHaveLength(0);
});

test("createEditorHost: appendGenerationLog accumulates entries in getGenerationLog", () => {
  const store = new EditorStore(defaultTimeline());
  const { host, appendGenerationLog } = createEditorHost(store, makeMediaHost(), makeGateway());

  appendGenerationLog({ id: "g1", model: "test-model", costCredits: 5, createdAt: "2024-01-01T00:00:00Z" });
  appendGenerationLog({ id: "g2", model: "test-model-2", costCredits: null, createdAt: null });

  const log = host.getGenerationLog();
  expect(log.entries).toHaveLength(2);
  expect(log.entries).toContainEqual({ id: "g1", model: "test-model", costCredits: 5, createdAt: "2024-01-01T00:00:00Z" });
  expect(log.entries).toContainEqual({ id: "g2", model: "test-model-2", costCredits: null, createdAt: null });
});

test("createEditorHost: loadDoc resets generation log from doc entries", () => {
  const store = new EditorStore(defaultTimeline());
  const { host, appendGenerationLog } = createEditorHost(store, makeMediaHost(), makeGateway());

  appendGenerationLog({ id: "g1", model: "m", costCredits: null, createdAt: null });
  expect(host.getGenerationLog().entries).toHaveLength(1);

  // loadDoc with entries should restore them
  host.loadDoc({
    timeline: defaultTimeline(),
    manifest: { version: 2, entries: [], folders: [] },
    generationLog: { version: 1, entries: [{ id: "loaded-1", model: "lm", costCredits: 1, createdAt: "t" }] },
  });

  expect(host.getGenerationLog().entries).toHaveLength(1);
  expect(host.getGenerationLog().entries[0]?.id).toBe("loaded-1");
});

test("createEditorHost: loadDoc with undefined generationLog clears the log", () => {
  const store = new EditorStore(defaultTimeline());
  const { host, appendGenerationLog } = createEditorHost(store, makeMediaHost(), makeGateway());

  appendGenerationLog({ id: "g1", model: "m", costCredits: null, createdAt: null });

  host.loadDoc({
    timeline: defaultTimeline(),
    manifest: { version: 2, entries: [], folders: [] },
    generationLog: { version: 1, entries: [] },
  });

  expect(host.getGenerationLog().entries).toHaveLength(0);
});

test("createEditorHost: loadDoc clears stuck in-flight generation status before entries reach the library", () => {
  const store = new EditorStore(defaultTimeline());
  const { host } = createEditorHost(store, makeMediaHost(), makeGateway());

  const stuck: MediaManifestEntry = {
    id: "stuck", name: "stuck", type: "image", duration: 5,
    source: { kind: "project", relativePath: "media/stuck.png" },
    generationStatus: "generating", // no backendJobId: not resumable
  };
  const resumable: MediaManifestEntry = {
    id: "resumable", name: "resumable", type: "image", duration: 5,
    source: { kind: "project", relativePath: "media/resumable.png" },
    generationStatus: "generating",
    generationInput: { prompt: "x", model: "m", duration: 5, aspectRatio: "1:1", backendJobId: "job-1" },
  };

  host.loadDoc({
    timeline: defaultTimeline(),
    manifest: { version: 2, entries: [stuck, resumable], folders: [] },
    generationLog: { version: 1, entries: [] },
  });

  const entries = host.getManifest().entries;
  expect(entries.find((e) => e.id === "stuck")?.generationStatus).toBeUndefined();
  expect(entries.find((e) => e.id === "resumable")?.generationStatus).toBe("generating");
});
