import { describe, expect, it } from "vitest";
import { LAYOUT_IDS, videoLayouts, layoutAnchors, layoutPlacement } from "./video-layout.js";

function approx(a: number, b: number, tol = 1e-6): void {
  expect(Math.abs(a - b)).toBeLessThan(tol);
}

describe("videoLayouts — slot ids/rects/z pinned per Swift VideoLayout.swift", () => {
  it("has exactly the 10 layouts in Swift's CaseIterable order", () => {
    expect(LAYOUT_IDS).toEqual([
      "full", "side_by_side", "top_bottom",
      "pip_bottom_right", "pip_bottom_left", "pip_top_right", "pip_top_left",
      "grid_2x2", "main_sidebar", "three_up",
    ]);
    expect(Object.keys(videoLayouts).sort()).toEqual([...LAYOUT_IDS].sort());
  });

  it("full: one slot 'main' covering the whole frame, z=0", () => {
    expect(videoLayouts.full).toEqual([{ id: "main", rect: { x: 0, y: 0, w: 1, h: 1 }, z: 0 }]);
  });

  it("side_by_side: left/right halves, z=0", () => {
    expect(videoLayouts.side_by_side).toEqual([
      { id: "left", rect: { x: 0, y: 0, w: 0.5, h: 1 }, z: 0 },
      { id: "right", rect: { x: 0.5, y: 0, w: 0.5, h: 1 }, z: 0 },
    ]);
  });

  it("top_bottom: top/bottom halves, z=0", () => {
    expect(videoLayouts.top_bottom).toEqual([
      { id: "top", rect: { x: 0, y: 0, w: 1, h: 0.5 }, z: 0 },
      { id: "bottom", rect: { x: 0, y: 0.5, w: 1, h: 0.5 }, z: 0 },
    ]);
  });

  it("grid_2x2: four quadrants, z=0", () => {
    expect(videoLayouts.grid_2x2).toEqual([
      { id: "top_left", rect: { x: 0, y: 0, w: 0.5, h: 0.5 }, z: 0 },
      { id: "top_right", rect: { x: 0.5, y: 0, w: 0.5, h: 0.5 }, z: 0 },
      { id: "bottom_left", rect: { x: 0, y: 0.5, w: 0.5, h: 0.5 }, z: 0 },
      { id: "bottom_right", rect: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 }, z: 0 },
    ]);
  });

  it("main_sidebar: 70/30 split, z=0", () => {
    expect(videoLayouts.main_sidebar).toEqual([
      { id: "main", rect: { x: 0, y: 0, w: 0.7, h: 1 }, z: 0 },
      { id: "sidebar", rect: { x: 0.7, y: 0, w: 0.3, h: 1 }, z: 0 },
    ]);
  });

  it("three_up: three equal thirds, z=0", () => {
    const third = 1 / 3;
    expect(videoLayouts.three_up).toEqual([
      { id: "left", rect: { x: 0, y: 0, w: third, h: 1 }, z: 0 },
      { id: "center", rect: { x: third, y: 0, w: third, h: 1 }, z: 0 },
      { id: "right", rect: { x: third * 2, y: 0, w: third, h: 1 }, z: 0 },
    ]);
  });

  it("PIP layouts: main z=0 full-frame, inset z=1 sized pipInset=0.28, positioned via pipMargin=0.035", () => {
    const pipInset = 0.28;
    const pipMargin = 0.035;
    const cases: [string, number, number][] = [
      ["pip_bottom_right", 1 - pipMargin - pipInset, 1 - pipMargin - pipInset],
      ["pip_bottom_left", pipMargin, 1 - pipMargin - pipInset],
      ["pip_top_right", 1 - pipMargin - pipInset, pipMargin],
      ["pip_top_left", pipMargin, pipMargin],
    ];
    for (const [id, insetX, insetY] of cases) {
      const slots = videoLayouts[id]!;
      expect(slots).toHaveLength(2);
      expect(slots[0]).toEqual({ id: "main", rect: { x: 0, y: 0, w: 1, h: 1 }, z: 0 });
      expect(slots[1]!.id).toBe("inset");
      expect(slots[1]!.z).toBe(1);
      approx(slots[1]!.rect.x, insetX);
      approx(slots[1]!.rect.y, insetY);
      approx(slots[1]!.rect.w, pipInset);
      approx(slots[1]!.rect.h, pipInset);
    }
  });
});

describe("layoutAnchors — named map per ToolExecutor+Layout.swift, verbatim", () => {
  it("has exactly the 9 named anchors", () => {
    expect(Object.keys(layoutAnchors).sort()).toEqual(
      ["bottom", "bottom_left", "bottom_right", "center", "left", "right", "top", "top_left", "top_right"].sort(),
    );
  });

  it("pins each anchor's (x, y)", () => {
    expect(layoutAnchors.center).toEqual({ x: 0.5, y: 0.5 });
    expect(layoutAnchors.top).toEqual({ x: 0.5, y: 0 });
    expect(layoutAnchors.bottom).toEqual({ x: 0.5, y: 1 });
    expect(layoutAnchors.left).toEqual({ x: 0, y: 0.5 });
    expect(layoutAnchors.right).toEqual({ x: 1, y: 0.5 });
    expect(layoutAnchors.top_left).toEqual({ x: 0, y: 0 });
    expect(layoutAnchors.top_right).toEqual({ x: 1, y: 0 });
    expect(layoutAnchors.bottom_left).toEqual({ x: 0, y: 1 });
    expect(layoutAnchors.bottom_right).toEqual({ x: 1, y: 1 });
  });
});

// --- layoutPlacement: hand-traced against Swift's EditorViewModel+Layout.swift math ---

describe("layoutPlacement — fill", () => {
  it("16:9 source (1920x1080) into side_by_side.left, center anchor: crops L/R symmetrically, centers at x=0.25", () => {
    const slot = videoLayouts.side_by_side![0]!; // left: {x:0,y:0,w:0.5,h:1}
    const canvasW = 1920, canvasH = 1080;
    const canvasAspect = canvasW / canvasH; // 16/9
    const target = (slot.rect.w / slot.rect.h) * canvasAspect; // 0.5 * 16/9 = 8/9
    const sourceAspect = 1920 / 1080; // 16/9

    const { transform, crop } = layoutPlacement(1920, 1080, slot, canvasW, canvasH, "fill", 0.5, 0.5);

    // sourceAspect > target (16/9 > 8/9): symmetric left/right crop
    const total = 1 - target / sourceAspect; // 1 - 0.5 = 0.5
    approx(crop.left, total * 0.5);
    approx(crop.right, total * 0.5);
    approx(crop.top, 0);
    approx(crop.bottom, 0);

    const vw = 1 - crop.left - crop.right;
    const expectedW = slot.rect.w / vw;
    const expectedH = slot.rect.h / 1;
    approx(transform.width, expectedW);
    approx(transform.height, expectedH);
    approx(transform.centerX, slot.rect.x - crop.left * expectedW + expectedW / 2);
    approx(transform.centerY, slot.rect.y + expectedH / 2);
    // Pinned numeric result (also the Swift ApplyLayoutTests.sideBySideFillsWithoutStretch expectation):
    approx(transform.centerX, 0.25);
    approx(transform.centerY, 0.5);
  });

  it("9:16 source (1080x1920) into pip_bottom_right.inset, center anchor: crops T/B, positions inside the inset square", () => {
    const slot = videoLayouts.pip_bottom_right![1]!; // inset
    const canvasW = 1920, canvasH = 1080;
    const canvasAspect = canvasW / canvasH;
    const target = (slot.rect.w / slot.rect.h) * canvasAspect; // w===h so target === canvasAspect
    const sourceAspect = 1080 / 1920;

    const { transform, crop } = layoutPlacement(1080, 1920, slot, canvasW, canvasH, "fill", 0.5, 0.5);

    // sourceAspect < target: symmetric top/bottom crop
    const total = 1 - sourceAspect / target;
    approx(crop.top, total * 0.5);
    approx(crop.bottom, total * 0.5);
    approx(crop.left, 0);
    approx(crop.right, 0);

    const vh = 1 - crop.top - crop.bottom;
    const expectedSide = slot.rect.w / vh; // w === h, vw === 1 so w = rect.w/1; h = rect.h/vh — square slot so both scale by 1/vh on h; w scales by 1/vw=1
    // w = rect.w / vw where vw = 1 (no L/R crop) => w = rect.w
    approx(transform.width, slot.rect.w);
    approx(transform.height, slot.rect.h / vh);
    approx(transform.centerX - transform.width / 2, slot.rect.x);
    const expectedH = slot.rect.h / vh;
    approx(transform.centerY, slot.rect.y - crop.top * expectedH + expectedH / 2);
    void expectedSide;
  });

  it("anchorX override biases the horizontal crop continuously (not just the named shortcuts)", () => {
    const slot = videoLayouts.side_by_side![0]!; // left
    const canvasW = 1920, canvasH = 1080;
    const { crop: centerCrop } = layoutPlacement(1920, 1080, slot, canvasW, canvasH, "fill", 0.5, 0.5);
    const { crop: biasedCrop } = layoutPlacement(1920, 1080, slot, canvasW, canvasH, "fill", 0.2, 0.5);
    const total = centerCrop.left + centerCrop.right;
    approx(biasedCrop.left, total * 0.2);
    approx(biasedCrop.right, total * 0.8);
  });
});

describe("layoutPlacement — fit (letterbox, no crop)", () => {
  it("16:9 source into top_bottom.top: crop stays identity, transform letterboxes with anchorY bias", () => {
    const slot = videoLayouts.top_bottom![0]!; // top: {x:0,y:0,w:1,h:0.5}
    const canvasW = 1920, canvasH = 1080;
    const canvasAspect = canvasW / canvasH;
    const rel = (1920 / 1080) / canvasAspect; // 1 — source aspect equals canvas aspect

    const { transform, crop } = layoutPlacement(1920, 1080, slot, canvasW, canvasH, "fit", 0.5, 1 /* bottom_right-style anchorY */);

    expect(crop).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
    // rel * rect.h <= rect.w? rel=1, rect.h=0.5, rect.w=1 -> 0.5 <= 1 true -> drawH=rect.h, drawW=rel*rect.h
    const drawH = slot.rect.h;
    const drawW = rel * slot.rect.h;
    approx(transform.width, drawW);
    approx(transform.height, drawH);
    // anchorY=1 (bottom-most within the slack): y = rect.y + (rect.h - drawH) * 1 = rect.y (no vertical slack here since drawH===rect.h)
    approx(transform.centerY, slot.rect.y + drawH / 2);
    // anchorX=0.5 centers any horizontal slack
    const slackX = slot.rect.w - drawW;
    approx(transform.centerX, slot.rect.x + slackX * 0.5 + drawW / 2);
  });

  it("portrait source into full frame with corner anchor: letterboxes into vertical bars, anchored via anchorX", () => {
    const slot = videoLayouts.full![0]!; // {x:0,y:0,w:1,h:1}
    const canvasW = 1080, canvasH = 1920; // portrait canvas
    const canvasAspect = canvasW / canvasH;
    const rel = (1920 / 1080) / canvasAspect; // wide source into a portrait canvas -> horizontal slack

    const { transform, crop } = layoutPlacement(1920, 1080, slot, canvasW, canvasH, "fit", 0.3, 0.5);
    expect(crop).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });

    // rel*rect.h <= rect.w? rel>1 typically (wide source), rect.h=1,rect.w=1 -> rel<=1 false unless exactly — compute both branches generically
    let drawW: number, drawH: number;
    if (rel * slot.rect.h <= slot.rect.w) { drawH = slot.rect.h; drawW = rel * slot.rect.h; }
    else { drawW = slot.rect.w; drawH = slot.rect.w / rel; }
    approx(transform.width, drawW);
    approx(transform.height, drawH);
    const slackX = slot.rect.w - drawW;
    approx(transform.centerX, slot.rect.x + slackX * 0.3 + drawW / 2);
  });
});

describe("layoutPlacement — degenerate inputs fall back gracefully", () => {
  it("missing source dims (<=0) in fill mode: identity crop, transform matches the slot rect", () => {
    const slot = videoLayouts.full![0]!;
    const { transform, crop } = layoutPlacement(0, 0, slot, 1920, 1080, "fill", 0.5, 0.5);
    expect(crop).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
    approx(transform.width, slot.rect.w);
    approx(transform.height, slot.rect.h);
    approx(transform.centerX, slot.rect.x + slot.rect.w / 2);
    approx(transform.centerY, slot.rect.y + slot.rect.h / 2);
  });

  it("missing source dims (<=0) in fit mode: identity crop, transform matches the slot rect", () => {
    const slot = videoLayouts.side_by_side![1]!;
    const { transform, crop } = layoutPlacement(0, 0, slot, 1920, 1080, "fit", 0.5, 0.5);
    expect(crop).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
    approx(transform.width, slot.rect.w);
    approx(transform.height, slot.rect.h);
  });

  it("source aspect within tolerance of target: identity crop", () => {
    const slot = videoLayouts.full![0]!; // target === canvasAspect for a full-frame slot
    const { crop } = layoutPlacement(1920, 1080, slot, 1920, 1080, "fill", 0.5, 0.5);
    expect(crop).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
  });
});
