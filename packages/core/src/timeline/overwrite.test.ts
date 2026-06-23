import { describe, it, expect } from "vitest";
import type { Clip } from "../clip.js";
import { computeOverwrite, applyOverwriteToClips } from "./overwrite.js";

function makeClip(overrides: Partial<Clip> & { id: string }): Clip {
  return {
    mediaRef: "m1",
    mediaType: "video",
    sourceClipType: "video",
    startFrame: 0,
    durationFrames: 30,
    trimStartFrame: 0,
    trimEndFrame: 0,
    speed: 1,
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    fadeInInterpolation: "linear",
    fadeOutInterpolation: "linear",
    opacity: 1,
    transform: { centerX: 0.5, centerY: 0.5, width: 1, height: 1, rotation: 0, flipHorizontal: false, flipVertical: false },
    crop: { left: 0, right: 0, top: 0, bottom: 0 },
    ...overrides,
  };
}

// --- computeOverwrite ---

describe("computeOverwrite — disjoint", () => {
  it("returns no actions when clip ends before region", () => {
    const clip = makeClip({ id: "c1", startFrame: 0, durationFrames: 10 });
    const actions = computeOverwrite([clip], 15, 25);
    expect(actions).toHaveLength(0);
  });

  it("returns no actions when clip starts after region", () => {
    const clip = makeClip({ id: "c1", startFrame: 30, durationFrames: 10 });
    const actions = computeOverwrite([clip], 10, 20);
    expect(actions).toHaveLength(0);
  });

  it("returns empty for empty region (start >= end)", () => {
    const clip = makeClip({ id: "c1", startFrame: 5, durationFrames: 10 });
    expect(computeOverwrite([clip], 10, 10)).toHaveLength(0);
    expect(computeOverwrite([clip], 15, 10)).toHaveLength(0);
  });

  it("clip touches region boundary exactly (end == regionStart) — disjoint", () => {
    const clip = makeClip({ id: "c1", startFrame: 0, durationFrames: 10 });
    // clip ends at 10, region starts at 10 => ce <= regionStart
    expect(computeOverwrite([clip], 10, 20)).toHaveLength(0);
  });

  it("clip starts at regionEnd exactly — disjoint", () => {
    const clip = makeClip({ id: "c1", startFrame: 20, durationFrames: 10 });
    // cs >= regionEnd
    expect(computeOverwrite([clip], 10, 20)).toHaveLength(0);
  });
});

describe("computeOverwrite — fully inside region → remove", () => {
  it("removes clip fully inside region", () => {
    const clip = makeClip({ id: "c1", startFrame: 5, durationFrames: 10 });
    const actions = computeOverwrite([clip], 0, 20);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toEqual({ kind: "remove", clipId: "c1" });
  });

  it("removes clip exactly matching region boundaries", () => {
    const clip = makeClip({ id: "c1", startFrame: 10, durationFrames: 10 });
    const actions = computeOverwrite([clip], 10, 20);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toEqual({ kind: "remove", clipId: "c1" });
  });
});

describe("computeOverwrite — spanning (clip wraps region) → split", () => {
  it("split: correct leftDuration, rightStartFrame, rightDuration (speed=1)", () => {
    // clip: 0..40, region: 10..30
    const clip = makeClip({ id: "c1", startFrame: 0, durationFrames: 40, trimStartFrame: 5, speed: 1 });
    const actions = computeOverwrite([clip], 10, 30);
    expect(actions).toHaveLength(1);
    const a = actions[0]!;
    expect(a.kind).toBe("split");
    if (a.kind !== "split") return;
    expect(a.clipId).toBe("c1");
    expect(a.leftDuration).toBe(10);     // regionStart - cs = 10 - 0
    expect(a.rightStartFrame).toBe(30);  // regionEnd
    // rightTrimStart = trimStartFrame + round((regionEnd - cs) * speed) = 5 + round(30 * 1) = 35
    expect(a.rightTrimStart).toBe(35);
    expect(a.rightDuration).toBe(10);    // ce - regionEnd = 40 - 30
  });

  it("split: rightTrimStart uses round((regionEnd - cs) * speed) for speed=2", () => {
    // clip: 0..50, region: 10..30, speed=2, trimStartFrame=0
    const clip = makeClip({ id: "c1", startFrame: 0, durationFrames: 50, trimStartFrame: 0, speed: 2 });
    const actions = computeOverwrite([clip], 10, 30);
    const a = actions[0]!;
    expect(a.kind).toBe("split");
    if (a.kind !== "split") return;
    // rightTrimStart = 0 + round((30 - 0) * 2) = 60
    expect(a.rightTrimStart).toBe(60);
  });

  it("split: assigns a non-empty rightId", () => {
    const clip = makeClip({ id: "c1", startFrame: 0, durationFrames: 40 });
    const actions = computeOverwrite([clip], 10, 30);
    const a = actions[0]!;
    expect(a.kind).toBe("split");
    if (a.kind !== "split") return;
    expect(a.rightId).toBeTruthy();
    expect(a.rightId).not.toBe("c1");
  });
});

describe("computeOverwrite — overlap left (clip extends past regionStart) → trimEnd", () => {
  it("trims clip right edge", () => {
    // clip: 0..20, region: 15..30 → clip starts before region, ends inside
    const clip = makeClip({ id: "c1", startFrame: 0, durationFrames: 20 });
    const actions = computeOverwrite([clip], 15, 30);
    expect(actions).toHaveLength(1);
    const a = actions[0]!;
    expect(a.kind).toBe("trimEnd");
    if (a.kind !== "trimEnd") return;
    expect(a.clipId).toBe("c1");
    expect(a.newDuration).toBe(15); // regionStart - cs = 15 - 0
  });
});

describe("computeOverwrite — overlap right (clip extends past regionEnd) → trimStart", () => {
  it("trims clip left edge", () => {
    // clip: 10..40, region: 0..25 → clip starts inside region, ends after
    const clip = makeClip({ id: "c1", startFrame: 10, durationFrames: 30, trimStartFrame: 2, speed: 1 });
    const actions = computeOverwrite([clip], 0, 25);
    expect(actions).toHaveLength(1);
    const a = actions[0]!;
    expect(a.kind).toBe("trimStart");
    if (a.kind !== "trimStart") return;
    expect(a.clipId).toBe("c1");
    expect(a.newStartFrame).toBe(25);   // regionEnd
    // trimAmount = regionEnd - cs = 25 - 10 = 15; newTrimStart = 2 + round(15 * 1) = 17
    expect(a.newTrimStart).toBe(17);
    expect(a.newDuration).toBe(15);     // ce - regionEnd = 40 - 25
  });

  it("trimStart: newTrimStart uses round(trimAmount * speed) for speed=1.5", () => {
    // clip: 10..40, region: 0..20, speed=1.5, trimStartFrame=0
    const clip = makeClip({ id: "c1", startFrame: 10, durationFrames: 30, trimStartFrame: 0, speed: 1.5 });
    const actions = computeOverwrite([clip], 0, 20);
    const a = actions[0]!;
    expect(a.kind).toBe("trimStart");
    if (a.kind !== "trimStart") return;
    // trimAmount = 20 - 10 = 10; newTrimStart = 0 + round(10 * 1.5) = 15
    expect(a.newTrimStart).toBe(15);
  });
});

describe("computeOverwrite — multiple clips", () => {
  it("handles multiple clips with different branches", () => {
    const c1 = makeClip({ id: "c1", startFrame: 0, durationFrames: 10 });   // disjoint (ends at 10, region starts at 15)
    const c2 = makeClip({ id: "c2", startFrame: 15, durationFrames: 5 });   // inside region [15,25)
    const c3 = makeClip({ id: "c3", startFrame: 18, durationFrames: 20 });  // overlap right (18..38, region 15..25)
    const actions = computeOverwrite([c1, c2, c3], 15, 25);
    expect(actions).toHaveLength(2);
    const kinds = actions.map((a) => a.kind);
    expect(kinds).toContain("remove");
    expect(kinds).toContain("trimStart");
  });
});

// --- applyOverwriteToClips ---

describe("applyOverwriteToClips", () => {
  it("returns original array reference when no actions", () => {
    const clips = [makeClip({ id: "c1" })];
    const result = applyOverwriteToClips(clips, []);
    expect(result).toBe(clips);
  });

  it("remove: drops the clip", () => {
    const c1 = makeClip({ id: "c1", startFrame: 5, durationFrames: 10 });
    const c2 = makeClip({ id: "c2", startFrame: 30, durationFrames: 10 });
    const result = applyOverwriteToClips([c1, c2], [{ kind: "remove", clipId: "c1" }]);
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("c2");
  });

  it("trimEnd: clips durationFrames via setDuration", () => {
    const c1 = makeClip({ id: "c1", startFrame: 0, durationFrames: 20 });
    const result = applyOverwriteToClips([c1], [{ kind: "trimEnd", clipId: "c1", newDuration: 10 }]);
    expect(result[0]!.durationFrames).toBe(10);
    expect(result[0]!.startFrame).toBe(0);
  });

  it("trimStart: updates startFrame, trimStartFrame, durationFrames", () => {
    const c1 = makeClip({ id: "c1", startFrame: 0, durationFrames: 30, trimStartFrame: 0, speed: 1 });
    const action = { kind: "trimStart" as const, clipId: "c1", newStartFrame: 10, newTrimStart: 10, newDuration: 20 };
    const result = applyOverwriteToClips([c1], [action]);
    expect(result[0]!.startFrame).toBe(10);
    expect(result[0]!.trimStartFrame).toBe(10);
    expect(result[0]!.durationFrames).toBe(20);
  });

  it("split: produces two clips (original shrunk + new right)", () => {
    const c1 = makeClip({ id: "c1", startFrame: 0, durationFrames: 40, trimStartFrame: 0 });
    const action = {
      kind: "split" as const,
      clipId: "c1",
      leftDuration: 10,
      rightId: "c1-right",
      rightStartFrame: 30,
      rightTrimStart: 30,
      rightDuration: 10,
    };
    const result = applyOverwriteToClips([c1], [action]);
    expect(result).toHaveLength(2);
    const left = result.find((c) => c.id === "c1")!;
    const right = result.find((c) => c.id === "c1-right")!;
    expect(left.durationFrames).toBe(10);
    expect(right.startFrame).toBe(30);
    expect(right.trimStartFrame).toBe(30);
    expect(right.durationFrames).toBe(10);
  });

  it("result is sorted by startFrame", () => {
    const c1 = makeClip({ id: "c1", startFrame: 50, durationFrames: 40, trimStartFrame: 0 });
    const c2 = makeClip({ id: "c2", startFrame: 5, durationFrames: 10 });
    // split c1 produces a right clip at frame 60
    const action = {
      kind: "split" as const,
      clipId: "c1",
      leftDuration: 10,
      rightId: "c1-right",
      rightStartFrame: 80,
      rightTrimStart: 30,
      rightDuration: 10,
    };
    const result = applyOverwriteToClips([c1, c2], [action]);
    const starts = result.map((c) => c.startFrame);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
  });

  it("round-trip: computeOverwrite + apply leaves non-overlapping clips untouched", () => {
    const c1 = makeClip({ id: "c1", startFrame: 0, durationFrames: 10 });
    const c2 = makeClip({ id: "c2", startFrame: 20, durationFrames: 10 });
    const actions = computeOverwrite([c1, c2], 5, 15);
    const result = applyOverwriteToClips([c1, c2], actions);
    // c1 should be trimmed (overlap left), c2 untouched
    const trimmed = result.find((c) => c.id === "c1")!;
    const intact = result.find((c) => c.id === "c2")!;
    expect(trimmed.durationFrames).toBe(5);  // 5 - 0
    expect(intact).toEqual(c2);
  });
});
