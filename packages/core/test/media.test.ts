import { describe, expect, test } from "vitest";
import { makeMediaFolder } from "../src/media.js";

describe("media folder factory", () => {
  test("generates an id and stores name", () => {
    const f = makeMediaFolder("B-roll");
    expect(f.name).toBe("B-roll");
    expect(typeof f.id).toBe("string");
    expect(f.id.length).toBeGreaterThan(0);
    expect(f.parentFolderId).toBeUndefined();
  });
});
