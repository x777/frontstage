import { describe, expect, test } from "vitest";
import { defaultTextStyle, defaultTransform, type TextLayer } from "@palmier/core";
import { layoutWordsLine, textRasterCacheKey } from "../src/render/text-rasterizer.js";

const size = { width: 200, height: 100 };

function layer(over: Partial<TextLayer> = {}): TextLayer {
  return { clipId: "t", text: "ONE TWO", style: defaultTextStyle(), transform: defaultTransform(), opacity: 1, zIndex: 0, ...over };
}

describe("textRasterCacheKey", () => {
  test("no wordState -> unchanged [text, style, renderSize] shape, byte-identical to pre-M11C", () => {
    const l = layer();
    const key = textRasterCacheKey(l, size);
    expect(key).toBe(JSON.stringify([l.text, l.style, size]));
  });

  test("a preset with an alignment fallback (wordState undefined) still yields the plain key", () => {
    const l = layer({ preset: "wordReveal" }); // wordState absent, e.g. mismatched wordTimings
    expect(textRasterCacheKey(l, size)).toBe(JSON.stringify([l.text, l.style, size]));
  });

  test("wordState present extends the key with preset/visibleCount/highlightIndex/soloIndex/highlightColor", () => {
    const l = layer({ preset: "wordReveal", wordState: { visibleCount: 1, highlightIndex: null, soloIndex: null } });
    const key = textRasterCacheKey(l, size);
    expect(key).toBe(JSON.stringify([l.text, l.style, size, "wordReveal", 1, null, null, undefined]));
  });

  test("two different visibleCounts produce different keys (cache miss on reveal)", () => {
    const a = textRasterCacheKey(layer({ preset: "wordReveal", wordState: { visibleCount: 0, highlightIndex: null, soloIndex: null } }), size);
    const b = textRasterCacheKey(layer({ preset: "wordReveal", wordState: { visibleCount: 1, highlightIndex: null, soloIndex: null } }), size);
    expect(a).not.toBe(b);
  });

  test("same discrete state at the same frame reuses the cache key (bounded to wordCount+1 variants)", () => {
    const state = { visibleCount: 2, highlightIndex: null, soloIndex: null };
    const a = textRasterCacheKey(layer({ preset: "wordReveal", wordState: state }), size);
    const b = textRasterCacheKey(layer({ preset: "wordReveal", wordState: { ...state } }), size);
    expect(a).toBe(b);
  });

  test("highlightPop vs highlightBlock at the same highlightIndex produce different keys (different visual treatment)", () => {
    const ws = { visibleCount: 2, highlightIndex: 0, soloIndex: null };
    const pop = textRasterCacheKey(layer({ preset: "highlightPop", wordState: ws }), size);
    const block = textRasterCacheKey(layer({ preset: "highlightBlock", wordState: ws }), size);
    expect(pop).not.toBe(block);
  });

  test("a different highlightColor produces a different key", () => {
    const ws = { visibleCount: 2, highlightIndex: 0, soloIndex: null };
    const a = textRasterCacheKey(layer({ preset: "highlightPop", wordState: ws, highlightColor: { r: 1, g: 0, b: 0, a: 1 } }), size);
    const b = textRasterCacheKey(layer({ preset: "highlightPop", wordState: ws, highlightColor: { r: 0, g: 1, b: 0, a: 1 } }), size);
    expect(a).not.toBe(b);
  });
});

describe("layoutWordsLine", () => {
  // Fake measure: each character is 10px wide (canvas-free — no OffscreenCanvas in this env).
  const measure = (w: string) => w.length * 10;

  test("center alignment centers the whole line on cx, words laid left-to-right", () => {
    const boxes = layoutWordsLine(["ONE", "TWO"], measure, 5, "center", 100);
    // widths: ONE=30, TWO=30, space=5 -> total=65 -> startX = 100-32.5 = 67.5
    expect(boxes).toHaveLength(2);
    expect(boxes[0]!.x).toBeCloseTo(67.5);
    expect(boxes[0]!.width).toBe(30);
    expect(boxes[1]!.x).toBeCloseTo(67.5 + 30 + 5);
    expect(boxes[1]!.width).toBe(30);
  });

  test("left alignment starts exactly at cx", () => {
    const boxes = layoutWordsLine(["AB", "CD"], measure, 4, "left", 50);
    expect(boxes[0]!.x).toBe(50);
    expect(boxes[1]!.x).toBe(50 + 20 + 4);
  });

  test("right alignment ends exactly at cx", () => {
    const boxes = layoutWordsLine(["AB", "CD"], measure, 4, "right", 50);
    const total = 20 + 20 + 4;
    expect(boxes[0]!.x).toBeCloseTo(50 - total);
    const last = boxes[boxes.length - 1]!;
    expect(last.x + last.width).toBeCloseTo(50);
  });

  test("a single word has no space contribution", () => {
    const boxes = layoutWordsLine(["SOLO"], measure, 999, "center", 0);
    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.x).toBeCloseTo(-20); // width 40, centered on 0 -> -20
  });

  test("word order/positions are stable regardless of how many are later drawn (no reflow)", () => {
    const words = ["ALPHA", "BETA", "GAMMA"];
    const boxes = layoutWordsLine(words, measure, 5, "center", 150);
    // Positions are computed from the FULL word list — a caller drawing only boxes[0] still gets
    // the same x/width it would if boxes[1]/[2] were also drawn.
    const boxesAgain = layoutWordsLine(words, measure, 5, "center", 150);
    expect(boxes).toEqual(boxesAgain);
  });
});
