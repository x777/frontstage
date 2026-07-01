import { describe, it, expect } from "vitest";
import {
  serializeGenerationStatus, parseGenerationStatus, canResumeGeneration, isRecoveringGeneration,
  createPlaceholderEntry, normalizeEntryForSave, normalizeEntryOnLoad,
} from "../src/media/generation-status.js";
import type { MediaManifestEntry } from "../src/media.js";

// Loose param type: test fixtures build generationInput with only the fields each case needs,
// not the full required shape — this helper is a test-only escape hatch (mirrors the `as` below).
const base = (over: Record<string, unknown>): MediaManifestEntry => ({
  id: "abcdef1234567890", name: "gen", type: "video", duration: 5,
  source: { kind: "project", relativePath: "media/gen-abcdef12.mp4" }, ...over,
} as MediaManifestEntry);

describe("status serialization", () => {
  it("round-trips the persisted kinds", () => {
    expect(serializeGenerationStatus({ kind: "generating" })).toBe("generating");
    expect(serializeGenerationStatus({ kind: "downloading" })).toBe("downloading");
    expect(serializeGenerationStatus({ kind: "rendering" })).toBe("rendering");
    expect(serializeGenerationStatus({ kind: "failed", message: "boom" })).toBe("failed: boom");
    expect(parseGenerationStatus("failed: boom")).toEqual({ kind: "failed", message: "boom" });
    expect(parseGenerationStatus("generating")).toEqual({ kind: "generating" });
  });
  it("none and preparing serialize to undefined (never persisted)", () => {
    expect(serializeGenerationStatus({ kind: "none" })).toBeUndefined();
    expect(serializeGenerationStatus({ kind: "preparing" })).toBeUndefined();
  });
  it("unknown/undefined parse to none", () => {
    expect(parseGenerationStatus(undefined)).toEqual({ kind: "none" });
    expect(parseGenerationStatus("weird")).toEqual({ kind: "none" });
  });
});

describe("resume predicates", () => {
  it("canResumeGeneration requires a backendJobId", () => {
    expect(canResumeGeneration(base({ generationInput: { prompt: "x", backendJobId: "j1" } }))).toBe(true);
    expect(canResumeGeneration(base({ generationInput: { prompt: "x" } }))).toBe(false);
    expect(canResumeGeneration(base({}))).toBe(false);
  });
  it("isRecoveringGeneration: in-flight statuses resume; failed resumes only with resultURLs", () => {
    const job = { prompt: "x", backendJobId: "j1" };
    expect(isRecoveringGeneration(base({ generationInput: job, generationStatus: "generating" }))).toBe(true);
    expect(isRecoveringGeneration(base({ generationInput: job, generationStatus: "downloading" }))).toBe(true);
    expect(isRecoveringGeneration(base({ generationInput: job, generationStatus: "failed: net" }))).toBe(false);
    expect(isRecoveringGeneration(base({ generationInput: { ...job, resultURLs: ["u"] }, generationStatus: "failed: net" }))).toBe(true);
    expect(isRecoveringGeneration(base({ generationStatus: "generating" }))).toBe(false); // no job id
  });
});

describe("placeholder factory + normalize", () => {
  it("reserves media/gen-<id8>.<ext> and starts preparing", () => {
    const e = createPlaceholderEntry({ id: "abcdef1234567890", type: "video", name: "Gen", duration: 5, ext: "mp4", genInput: { prompt: "p" } });
    expect(e.source).toEqual({ kind: "project", relativePath: "media/gen-abcdef12.mp4" });
    expect(e.generationStatus).toBe("preparing");
    expect(e.generationInput?.prompt).toBe("p");
  });
  it("normalizeEntryForSave strips preparing", () => {
    const e = createPlaceholderEntry({ id: "abcdef1234567890", type: "video", name: "Gen", duration: 5, ext: "mp4", genInput: { prompt: "p" } });
    expect(normalizeEntryForSave(e).generationStatus).toBeUndefined();
    const gen = base({ generationStatus: "generating", generationInput: { prompt: "p", backendJobId: "j" } });
    expect(normalizeEntryForSave(gen).generationStatus).toBe("generating"); // persisted kinds survive
  });
  it("normalizeEntryOnLoad resets stuck non-resumable statuses to none", () => {
    const stuck = base({ generationStatus: "generating" }); // no backendJobId
    expect(normalizeEntryOnLoad(stuck).generationStatus).toBeUndefined();
    const resumable = base({ generationStatus: "generating", generationInput: { prompt: "p", backendJobId: "j" } });
    expect(normalizeEntryOnLoad(resumable).generationStatus).toBe("generating");
    const failed = base({ generationStatus: "failed: boom" }); // failed always survives load (visible error)
    expect(normalizeEntryOnLoad(failed).generationStatus).toBe("failed: boom");
  });
});
