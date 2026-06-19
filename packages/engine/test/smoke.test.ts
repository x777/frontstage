import { expect, test } from "vitest";
import { ENGINE_VERSION } from "../src/index.js";

test("engine package exposes a version", () => {
  expect(ENGINE_VERSION).toBe("0.0.0");
});
