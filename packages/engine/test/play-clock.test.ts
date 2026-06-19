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

test("resume continuity: pause then restart accumulates frames correctly", () => {
  let t = 0;
  const clock = new PlayClock(30, () => t);
  clock.start(0);
  t = 1000;  // ~30 frames elapsed
  clock.pause();
  const mid = clock.frame;
  clock.start(mid);  // resume from paused position
  t = 2000;  // another 1000ms elapsed
  expect(clock.frame).toBeCloseTo(mid + 30, 5);
});
