import { expect, test } from "vitest";
import { PlayClock } from "../src/clock/play-clock.js";

test("advances frame based on elapsed time", () => {
  let t = 0;
  const clock = new PlayClock(30, () => t);
  clock.start(0);
  t = 1000;
  expect(clock.frame).toBeCloseTo(30, 5);
});

test("pause freezes frame", () => {
  let t = 0;
  const clock = new PlayClock(30, () => t);
  clock.start(0);
  t = 500;
  clock.pause();
  const frozen = clock.frame;
  t = 2000;
  expect(clock.frame).toBe(frozen);
});

test("start from non-zero frame", () => {
  let t = 0;
  const clock = new PlayClock(30, () => t);
  clock.start(10);
  t = 1000;
  expect(clock.frame).toBeCloseTo(40, 5);
});
