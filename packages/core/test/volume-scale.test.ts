import { describe, expect, test } from "vitest";
import { dbFromLinear, linearFromDb, VOLUME_FLOOR_DB } from "../src/volume-scale.js";

describe("volume scale", () => {
  test("0 dB is unity gain", () => {
    expect(linearFromDb(0)).toBeCloseTo(1);
  });
  test("floor maps to silence", () => {
    expect(linearFromDb(VOLUME_FLOOR_DB)).toBe(0);
  });
  test("dbFromLinear inverts unity", () => {
    expect(dbFromLinear(1)).toBeCloseTo(0);
  });
});
