import { describe, expect, test } from "vitest";
import { formatTimecode, frameToSeconds, secondsToFrame } from "../src/time.js";

describe("time", () => {
  test("secondsToFrame truncates toward zero", () => {
    expect(secondsToFrame(2, 30)).toBe(60);
    expect(secondsToFrame(2.99, 30)).toBe(89);
  });
  test("frameToSeconds inverts", () => {
    expect(frameToSeconds(60, 30)).toBe(2);
  });
  test("fps <= 0 is safe", () => {
    expect(secondsToFrame(5, 0)).toBe(0);
    expect(frameToSeconds(5, 0)).toBe(0);
    expect(formatTimecode(5, 0)).toBe("00:00:00:00");
  });
  test("formatTimecode formats and signs", () => {
    expect(formatTimecode(90, 30)).toBe("00:00:03:00");
    expect(formatTimecode(-31, 30)).toBe("-00:00:01:01");
  });
});
