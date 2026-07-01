import { describe, it, expect } from "vitest";
import { scanResumableGenerations, resetStuckGenerations } from "../src/media/generation-recovery.js";
import type { GenerationInput, MediaManifestEntry } from "../src/media.js";

const base = (over: Partial<MediaManifestEntry>): MediaManifestEntry => ({
  id: "abcdef1234567890", name: "gen", type: "video", duration: 5,
  source: { kind: "project", relativePath: "media/gen-abcdef12.mp4" }, ...over,
});

// Sentinel-bearing input, like Swift's call sites (prompt/model/duration/aspectRatio always present).
const gin = (over: Partial<GenerationInput> = {}): GenerationInput => ({
  prompt: "x", model: "", duration: 0, aspectRatio: "", ...over,
});

describe("scanResumableGenerations", () => {
  it("groups placeholders sharing a jobId, sorted by outputIndex", () => {
    const a = base({ id: "a", generationStatus: "generating", generationInput: gin({ backendJobId: "j1", outputIndex: 1 }) });
    const b = base({ id: "b", generationStatus: "downloading", generationInput: gin({ backendJobId: "j1", outputIndex: 0 }) });
    const groups = scanResumableGenerations([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.backendJobId).toBe("j1");
    expect(groups[0]?.entries.map((e) => e.id)).toEqual(["b", "a"]);
  });

  it("a distinct jobId gets its own group, in first-appearance order", () => {
    const a = base({ id: "a", generationStatus: "generating", generationInput: gin({ backendJobId: "j1", outputIndex: 0 }) });
    const c = base({ id: "c", generationStatus: "rendering", generationInput: gin({ backendJobId: "j2", outputIndex: 0 }) });
    const groups = scanResumableGenerations([c, a]);
    expect(groups.map((g) => g.backendJobId)).toEqual(["j2", "j1"]);
  });

  it("excludes non-resumable entries: no jobId, plain, stuck in-flight without jobId", () => {
    const noJobId = base({ id: "no-job", generationStatus: "generating" });
    const plain = base({ id: "plain" });
    const entries = [noJobId, plain];
    expect(scanResumableGenerations(entries)).toEqual([]);
  });

  it("includes failed entries that carry resultURLs", () => {
    const failed = base({
      id: "f", generationStatus: "failed: net",
      generationInput: gin({ backendJobId: "j3", outputIndex: 0, resultURLs: ["u"] }),
    });
    const groups = scanResumableGenerations([failed]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.entries.map((e) => e.id)).toEqual(["f"]);
  });
});

describe("resetStuckGenerations", () => {
  it("clears a stuck in-flight status, keeps resumable and failed as-is, passes plain entries through unchanged", () => {
    const stuck = base({ id: "stuck", generationStatus: "generating" }); // no backendJobId
    const resumable = base({ id: "resumable", generationStatus: "generating", generationInput: gin({ backendJobId: "j1" }) });
    const failed = base({ id: "failed", generationStatus: "failed: boom" });
    const plain = base({ id: "plain" });

    const result = resetStuckGenerations([stuck, resumable, failed, plain]);

    expect(result[0]?.generationStatus).toBeUndefined();
    expect(result[1]?.generationStatus).toBe("generating");
    expect(result[2]?.generationStatus).toBe("failed: boom");
    expect(result[3]).toBe(plain); // untouched entries keep identity
  });
});
