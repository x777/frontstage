import { test, expect } from "vitest";
import type { MediaManifestEntry } from "@palmier/core";
import { generationStatusByRef } from "../src/timeline/TimelinePanel.js";

function entry(id: string, generationStatus?: string): MediaManifestEntry {
  return {
    id,
    name: `${id}.mp4`,
    type: "video",
    source: { kind: "project", relativePath: `media/${id}.mp4` },
    duration: 5,
    ...(generationStatus !== undefined ? { generationStatus } : {}),
  };
}

test("generationStatusByRef: includes only entries with a status, keyed by id", () => {
  const entries = [entry("a", "generating"), entry("b"), entry("c", "failed: boom")];
  const map = generationStatusByRef(entries);
  expect(map.size).toBe(2);
  expect(map.get("a")).toBe("generating");
  expect(map.get("c")).toBe("failed: boom");
  expect(map.has("b")).toBe(false);
});

test("generationStatusByRef: empty entries yields an empty map", () => {
  expect(generationStatusByRef([]).size).toBe(0);
});
