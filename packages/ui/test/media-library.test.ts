import { test, expect } from "vitest";
import type { MediaManifestEntry } from "@palmier/core";
import { MediaLibrary } from "../src/media/media-library.js";

function placeholderEntry(id: string): MediaManifestEntry {
  return {
    id,
    name: "gen.mp4",
    type: "video",
    source: { kind: "project", relativePath: `media/gen-${id}.mp4` },
    duration: 5,
    generationStatus: "preparing",
  };
}

function realEntry(id: string): MediaManifestEntry {
  return {
    id,
    name: "clip.mp4",
    type: "video",
    source: { kind: "project", relativePath: `media/${id}.mp4` },
    duration: 3,
  };
}

test("addPlaceholder: appears in snapshot with preparing status and no pending bytes", () => {
  const lib = new MediaLibrary();
  const entry = placeholderEntry("a");
  lib.addPlaceholder(entry);

  const snap = lib.getSnapshot();
  expect(snap.entries).toHaveLength(1);
  expect(snap.entries[0]?.id).toBe("a");
  expect(snap.entries[0]?.generationStatus).toBe("preparing");
  expect(lib.pendingMedia().has(entry.source.kind === "project" ? entry.source.relativePath : "")).toBe(false);
  expect(lib.pendingMedia().size).toBe(0);
});

test("addPlaceholder: emits once", () => {
  const lib = new MediaLibrary();
  let calls = 0;
  lib.subscribe(() => calls++);
  lib.addPlaceholder(placeholderEntry("a"));
  expect(calls).toBe(1);
});

test("patchEntry: updates the named entry by id, leaves others untouched by reference", () => {
  const lib = new MediaLibrary();
  const a = realEntry("a");
  const b = realEntry("b");
  lib.addEntry(a, new Uint8Array([1]));
  lib.addEntry(b, new Uint8Array([2]));

  lib.patchEntry("a", { duration: 42 });

  const snap = lib.getSnapshot();
  const patchedA = snap.entries.find((e) => e.id === "a");
  const untouchedB = snap.entries.find((e) => e.id === "b");
  expect(patchedA?.duration).toBe(42);
  expect(patchedA).not.toBe(a);
  expect(untouchedB).toBe(b);
});

test("patchEntry: no-op for unknown id", () => {
  const lib = new MediaLibrary();
  const a = realEntry("a");
  lib.addEntry(a, new Uint8Array([1]));

  let calls = 0;
  lib.subscribe(() => calls++);
  lib.patchEntry("missing", { duration: 99 });

  const snap = lib.getSnapshot();
  expect(snap.entries).toHaveLength(1);
  expect(snap.entries[0]).toBe(a);
  // still a no-op operation; emit-on-noop is acceptable either way, only entries must be unchanged
  expect(calls).toBeLessThanOrEqual(1);
});

test("finalizeGenerated: lands bytes at reserved relativePath, clears status, applies patch", () => {
  const lib = new MediaLibrary();
  const placeholder = placeholderEntry("a");
  lib.addPlaceholder(placeholder);

  const bytes = new Uint8Array([9, 9, 9]);
  lib.finalizeGenerated("a", bytes, { duration: 12, sourceWidth: 640, sourceHeight: 360 });

  const relativePath = placeholder.source.kind === "project" ? placeholder.source.relativePath : "";
  const pending = lib.pendingMedia();
  expect(pending.get(relativePath)).toEqual(bytes);

  const snap = lib.getSnapshot();
  const finalized = snap.entries.find((e) => e.id === "a");
  expect(finalized?.generationStatus).toBeUndefined();
  expect(finalized?.duration).toBe(12);
  expect(finalized?.sourceWidth).toBe(640);
  expect(finalized?.sourceHeight).toBe(360);
});

test("finalizeGenerated: emits once", () => {
  const lib = new MediaLibrary();
  const placeholder = placeholderEntry("a");
  lib.addPlaceholder(placeholder);

  let calls = 0;
  lib.subscribe(() => calls++);
  lib.finalizeGenerated("a", new Uint8Array([1]), { duration: 12 });
  expect(calls).toBe(1);
});

test("markGenerationFailed: stamps the message on all listed ids in one emit", () => {
  const lib = new MediaLibrary();
  lib.addPlaceholder(placeholderEntry("a"));
  lib.addPlaceholder(placeholderEntry("b"));
  lib.addPlaceholder(placeholderEntry("c"));

  let calls = 0;
  lib.subscribe(() => calls++);
  lib.markGenerationFailed(["a", "b"], "boom");

  const snap = lib.getSnapshot();
  expect(snap.entries.find((e) => e.id === "a")?.generationStatus).toBe("failed: boom");
  expect(snap.entries.find((e) => e.id === "b")?.generationStatus).toBe("failed: boom");
  expect(snap.entries.find((e) => e.id === "c")?.generationStatus).toBe("preparing");
  expect(calls).toBe(1);
});

test("bytesFor: returns in-memory bytes for a project-source entry added via addEntry", () => {
  const lib = new MediaLibrary();
  const entry = realEntry("a");
  const bytes = new Uint8Array([1, 2, 3]);
  lib.addEntry(entry, bytes);

  expect(lib.bytesFor(entry)).toEqual(bytes);
});

test("bytesFor: undefined for an entry with no in-memory bytes (placeholder, not yet finalized)", () => {
  const lib = new MediaLibrary();
  const entry = placeholderEntry("a");
  lib.addPlaceholder(entry);

  expect(lib.bytesFor(entry)).toBeUndefined();
});

test("bytesFor: undefined for a non-project source", () => {
  const lib = new MediaLibrary();
  const entry: MediaManifestEntry = { id: "x", name: "ext.mp4", type: "video", source: { kind: "external", absolutePath: "/tmp/x.mp4" }, duration: 1 };

  expect(lib.bytesFor(entry)).toBeUndefined();
});

test("readMedia: delegates to the configured gateway", async () => {
  const lib = new MediaLibrary();
  const reads: string[] = [];
  lib.setGateway({
    writeMedia: async () => {},
    readMedia: async (rel) => { reads.push(rel); return new Uint8Array([9, 9]); },
    hasMedia: async () => true,
  });

  const bytes = await lib.readMedia("media/a.mp4");

  expect(bytes).toEqual(new Uint8Array([9, 9]));
  expect(reads).toEqual(["media/a.mp4"]);
});

test("readMedia: throws when no gateway is configured", async () => {
  const lib = new MediaLibrary();
  await expect(lib.readMedia("media/a.mp4")).rejects.toThrow(/gateway/);
});
