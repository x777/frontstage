import { describe, expect, test } from "vitest";
import { CURRENT_SCHEMA_VERSION, migrateProjectJson } from "../src/schema/migrations.js";

describe("migrations", () => {
  test("absent version is treated as legacy and stamped to current", () => {
    const out = migrateProjectJson({ fps: 30, tracks: [] });
    expect(out.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });
  test("already-current docs pass through unchanged in content", () => {
    const out = migrateProjectJson({ schemaVersion: CURRENT_SCHEMA_VERSION, fps: 24, tracks: [] });
    expect(out.fps).toBe(24);
    expect(out.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });
  test("non-object input throws", () => {
    expect(() => migrateProjectJson(null)).toThrow();
  });
});
