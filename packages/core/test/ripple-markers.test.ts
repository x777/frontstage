import { describe, expect, test } from "vitest";
import { defaultTimelineMarker } from "../src/timeline-marker.js";
import { rippleMarkersClosing, rippleMarkersOpening } from "../src/timeline/ripple-engine.js";

function m(id: string, start: number, duration = 0) {
  return defaultTimelineMarker({ id, name: id, startFrame: start, durationFrames: duration });
}

describe("rippleMarkersClosing", () => {
  test("drops a point inside the removed range and shifts later points", () => {
    const next = rippleMarkersClosing(
      [m("before", 10), m("inside", 45), m("join", 50), m("after", 80)],
      [[{ start: 40, end: 50 }]],
    );
    expect(next.map((x) => x.id)).toEqual(["before", "join", "after"]);
    expect(next.map((x) => x.startFrame)).toEqual([10, 40, 70]);
  });

  test("shrinks overlapping range and deletes consumed range", () => {
    const next = rippleMarkersClosing(
      [m("overlap", 10, 40), m("consumed", 40, 10), m("after", 60, 20)],
      [[{ start: 40, end: 50 }]],
    );
    expect(next.map((x) => x.id)).toEqual(["overlap", "after"]);
    expect(next[0]!.startFrame).toBe(10);
    expect(next[0]!.durationFrames).toBe(30);
    expect(next[1]!.startFrame).toBe(50);
    expect(next[1]!.durationFrames).toBe(20);
  });

  test("keeps points that still exist on another track", () => {
    const next = rippleMarkersClosing(
      [m("onPicture", 220), m("after", 300)],
      [[{ start: 0, end: 50 }], [{ start: 200, end: 250 }]],
    );
    expect(next.map((x) => x.id)).toEqual(["onPicture", "after"]);
    expect(next.map((x) => x.startFrame)).toEqual([170, 250]);
  });

  test("ignores collapsed maps from tracks that removed the point", () => {
    const next = rippleMarkersClosing(
      [m("onPicture", 220)],
      [[{ start: 0, end: 50 }], [{ start: 100, end: 250 }]],
    );
    expect(next.map((x) => x.startFrame)).toEqual([170]);
  });

  test("keeps a range that another track consumed", () => {
    const next = rippleMarkersClosing(
      [m("span", 300, 50)],
      [[{ start: 0, end: 50 }], [{ start: 200, end: 400 }]],
    );
    expect(next.map((x) => x.id)).toEqual(["span"]);
    expect(next[0]!.startFrame).toBe(250);
    expect(next[0]!.durationFrames).toBe(50);
  });
});

describe("rippleMarkersOpening", () => {
  test("shifts at-or-after and extends a containing range", () => {
    const next = rippleMarkersOpening(
      [m("before", 10), m("range", 20, 40), m("at", 50)],
      50,
      20,
    );
    expect(next.map((x) => x.startFrame)).toEqual([10, 20, 70]);
    expect(next[1]!.durationFrames).toBe(60);
  });

  test("negative opening closes the trimmed tail", () => {
    const next = rippleMarkersOpening([m("tail", 90), m("after", 120)], 100, -20);
    expect(next.map((x) => x.id)).toEqual(["after"]);
    expect(next[0]!.startFrame).toBe(100);
  });
});
