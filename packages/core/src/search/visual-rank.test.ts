import { describe, expect, test } from "vitest";
import { rankVisualMatches, VISUAL_MATCH_COSINE_FLOOR, VISUAL_MATCH_RELATIVE_CUTOFF } from "./visual-rank.js";
import type { EmbeddingRow } from "./embedding-codec.js";

function unitRow(time: number, shotStart: number, shotEnd: number, x: number, y: number): EmbeddingRow {
  return { time, shotStart, shotEnd, vector: Float32Array.from([x, y]) };
}

describe("rankVisualMatches", () => {
  test("best-per-shot dedupe: only the highest-scoring row of a shot survives", () => {
    const query = Float32Array.from([1, 0]);
    const candidates = [
      {
        mediaRef: "a",
        rows: [unitRow(0, 0, 4, 0.5, 0.5), unitRow(1, 0, 4, 0.9, 0.1), unitRow(2, 0, 4, 0.3, 0.7)],
      },
    ];
    const hits = rankVisualMatches(query, candidates, 10);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.timeSec).toBe(1); // the row scoring 0.9
    expect(hits[0]!.score).toBeCloseTo(0.9, 5);
  });

  test("keeps the best row independently per shot within the same asset", () => {
    const query = Float32Array.from([1, 0]);
    const candidates = [
      {
        mediaRef: "a",
        rows: [unitRow(0, 0, 2, 0.9, 0), unitRow(2, 2, 4, 0.8, 0)],
      },
    ];
    const hits = rankVisualMatches(query, candidates, 10);
    expect(hits.map((h) => h.timeSec).sort()).toEqual([0, 2]);
  });

  test("the absolute cosine floor excludes low-scoring hits", () => {
    const query = Float32Array.from([1, 0]);
    const candidates = [
      { mediaRef: "a", rows: [unitRow(0, 0, 0, 0.5, 0)] }, // clears the floor and stays "top"
      { mediaRef: "b", rows: [unitRow(0, 0, 0, 0.01, 0)] }, // below VISUAL_MATCH_COSINE_FLOOR (0.05)
    ];
    expect(VISUAL_MATCH_COSINE_FLOOR).toBe(0.05);
    const hits = rankVisualMatches(query, candidates, 10);
    expect(hits.map((h) => h.mediaRef)).toEqual(["a"]);
  });

  test("the relative cutoff (0.85 * top) excludes hits that clear the floor but trail the leader", () => {
    const query = Float32Array.from([1, 0]);
    const candidates = [
      { mediaRef: "a", rows: [unitRow(0, 0, 0, 1.0, 0)] }, // top score 1.0
      { mediaRef: "b", rows: [unitRow(0, 0, 0, 0.9, 0)] }, // 0.9 >= 0.85 -> kept
      { mediaRef: "c", rows: [unitRow(0, 0, 0, 0.8, 0)] }, // 0.8 < 0.85 -> dropped
    ];
    expect(VISUAL_MATCH_RELATIVE_CUTOFF).toBe(0.85);
    const hits = rankVisualMatches(query, candidates, 10);
    expect(hits.map((h) => h.mediaRef)).toEqual(["a", "b"]);
  });

  test("truncates to `limit` even when more candidates would clear both cutoffs", () => {
    const query = Float32Array.from([1, 0]);
    const candidates = [
      { mediaRef: "a", rows: [unitRow(0, 0, 0, 1.0, 0)] },
      { mediaRef: "b", rows: [unitRow(0, 0, 0, 0.95, 0)] },
      { mediaRef: "c", rows: [unitRow(0, 0, 0, 0.9, 0)] }, // all three clear the 0.85*top floor
    ];
    const hits = rankVisualMatches(query, candidates, 2);
    expect(hits.map((h) => h.mediaRef)).toEqual(["a", "b"]);
  });

  test("sorts descending by score", () => {
    const query = Float32Array.from([1, 0]);
    const candidates = [
      { mediaRef: "a", rows: [unitRow(0, 0, 0, 0.9, 0)] },
      { mediaRef: "b", rows: [unitRow(0, 0, 0, 1.0, 0)] },
      { mediaRef: "c", rows: [unitRow(0, 0, 0, 0.95, 0)] },
    ];
    // All three clear the relative floor (0.85 * top) — sort order is the only thing under test.
    const hits = rankVisualMatches(query, candidates, 10);
    expect(hits.map((h) => h.mediaRef)).toEqual(["b", "c", "a"]);
  });

  test("deterministic tie order: equal scores keep first-seen (candidate array) order", () => {
    const query = Float32Array.from([1, 0]);
    const candidates = [
      { mediaRef: "a", rows: [unitRow(0, 0, 0, 0.5, 0)] },
      { mediaRef: "b", rows: [unitRow(0, 0, 0, 0.5, 0)] },
      { mediaRef: "c", rows: [unitRow(0, 0, 0, 0.5, 0)] },
    ];
    const hits1 = rankVisualMatches(query, candidates, 10);
    const hits2 = rankVisualMatches(query, candidates, 10);
    expect(hits1.map((h) => h.mediaRef)).toEqual(["a", "b", "c"]);
    expect(hits1.map((h) => h.mediaRef)).toEqual(hits2.map((h) => h.mediaRef));
  });

  test("a candidate whose vector dim doesn't match the query is skipped entirely", () => {
    const query = Float32Array.from([1, 0, 0]);
    const candidates = [
      { mediaRef: "a", rows: [{ time: 0, shotStart: 0, shotEnd: 0, vector: Float32Array.from([1, 0]) }] },
      { mediaRef: "b", rows: [{ time: 0, shotStart: 0, shotEnd: 0, vector: Float32Array.from([1, 0, 0]) }] },
    ];
    const hits = rankVisualMatches(query, candidates, 10);
    expect(hits.map((h) => h.mediaRef)).toEqual(["b"]);
  });

  test("a candidate with no rows is skipped", () => {
    const query = Float32Array.from([1, 0]);
    const hits = rankVisualMatches(query, [{ mediaRef: "a", rows: [] }], 10);
    expect(hits).toEqual([]);
  });

  test("no candidates yields no hits", () => {
    expect(rankVisualMatches(Float32Array.from([1, 0]), [], 10)).toEqual([]);
  });

  test("a non-positive top score yields no hits", () => {
    const query = Float32Array.from([1, 0]);
    const candidates = [{ mediaRef: "a", rows: [unitRow(0, 0, 0, -1, 0)] }];
    expect(rankVisualMatches(query, candidates, 10)).toEqual([]);
  });
});
