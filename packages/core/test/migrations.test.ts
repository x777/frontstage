import { describe, expect, test } from "vitest";
import { CURRENT_SCHEMA_VERSION, migrateProjectJson } from "../src/schema/migrations.js";

describe("migrations", () => {
  test("absent version is treated as legacy and stamped to current", () => {
    const out = migrateProjectJson({ fps: 30, tracks: [] });
    expect(out.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(Array.isArray(out.timelines)).toBe(true);
    expect((out.timelines as unknown[]).length).toBe(1);
  });
  test("v2 bare timeline wraps into ProjectFile", () => {
    const out = migrateProjectJson({ schemaVersion: 2, fps: 24, tracks: [] });
    expect(out.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    const timelines = out.timelines as { fps: number }[];
    expect(timelines[0]!.fps).toBe(24);
    expect(typeof out.activeTimelineId).toBe("string");
  });
  test("already-current ProjectFile docs pass through", () => {
    const out = migrateProjectJson({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      timelines: [{ id: "t1", name: "A", fps: 24, tracks: [] }],
      activeTimelineId: "t1",
    });
    expect(out.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect((out.timelines as { id: string }[])[0]!.id).toBe("t1");
  });
  test("non-object input throws", () => {
    expect(() => migrateProjectJson(null)).toThrow();
  });
});
