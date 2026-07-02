import { describe, it, expect } from "vitest";
import {
  serializeGenerationStatus, parseGenerationStatus, canResumeGeneration, isRecoveringGeneration,
  createPlaceholderEntry, normalizeEntryForSave, normalizeEntryOnLoad,
} from "../src/media/generation-status.js";
import type { GenerationInput, MediaManifestEntry } from "../src/media.js";

const base = (over: Partial<MediaManifestEntry>): MediaManifestEntry => ({
  id: "abcdef1234567890", name: "gen", type: "video", duration: 5,
  source: { kind: "project", relativePath: "media/gen-abcdef12.mp4" }, ...over,
});

// Sentinel-bearing input, like Swift's call sites (prompt/model/duration/aspectRatio always present).
const gin = (over: Partial<GenerationInput> = {}): GenerationInput => ({
  prompt: "x", model: "", duration: 0, aspectRatio: "", ...over,
});

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
  it("transcribing round-trips explicitly (not via the parse default)", () => {
    expect(serializeGenerationStatus({ kind: "transcribing" })).toBe("transcribing");
    expect(parseGenerationStatus("transcribing")).toEqual({ kind: "transcribing" });
  });
});

describe("resume predicates", () => {
  it("canResumeGeneration requires a backendJobId", () => {
    expect(canResumeGeneration(base({ generationInput: gin({ backendJobId: "j1" }) }))).toBe(true);
    expect(canResumeGeneration(base({ generationInput: gin() }))).toBe(false);
    expect(canResumeGeneration(base({}))).toBe(false);
  });
  it("isRecoveringGeneration: in-flight statuses resume; failed resumes only with resultURLs", () => {
    const job = gin({ backendJobId: "j1" });
    expect(isRecoveringGeneration(base({ generationInput: job, generationStatus: "generating" }))).toBe(true);
    expect(isRecoveringGeneration(base({ generationInput: job, generationStatus: "downloading" }))).toBe(true);
    expect(isRecoveringGeneration(base({ generationInput: job, generationStatus: "failed: net" }))).toBe(false);
    expect(isRecoveringGeneration(base({ generationInput: gin({ backendJobId: "j1", resultURLs: ["u"] }), generationStatus: "failed: net" }))).toBe(true);
    expect(isRecoveringGeneration(base({ generationStatus: "generating" }))).toBe(false); // no job id
  });
  it("isRecoveringGeneration excludes transcribing (not resumable, even with a job id)", () => {
    const job = gin({ backendJobId: "j1" });
    expect(isRecoveringGeneration(base({ generationInput: job, generationStatus: "transcribing" }))).toBe(false);
  });
});

describe("placeholder factory + normalize", () => {
  it("reserves media/gen-<id8>.<ext> and starts preparing", () => {
    const e = createPlaceholderEntry({ id: "abcdef1234567890", type: "video", name: "Gen", duration: 5, ext: "mp4", genInput: gin({ prompt: "p" }) });
    expect(e.source).toEqual({ kind: "project", relativePath: "media/gen-abcdef12.mp4" });
    expect(e.generationStatus).toBe("preparing");
    expect(e.generationInput?.prompt).toBe("p");
  });
  it("normalizeEntryForSave strips preparing", () => {
    const e = createPlaceholderEntry({ id: "abcdef1234567890", type: "video", name: "Gen", duration: 5, ext: "mp4", genInput: gin({ prompt: "p" }) });
    expect(normalizeEntryForSave(e).generationStatus).toBeUndefined();
    const gen = base({ generationStatus: "generating", generationInput: gin({ prompt: "p", backendJobId: "j" }) });
    expect(normalizeEntryForSave(gen).generationStatus).toBe("generating"); // persisted kinds survive
  });
  it("normalizeEntryOnLoad resets stuck non-resumable statuses to none", () => {
    const stuck = base({ generationStatus: "generating" }); // no backendJobId
    expect(normalizeEntryOnLoad(stuck).generationStatus).toBeUndefined();
    const resumable = base({ generationStatus: "generating", generationInput: gin({ prompt: "p", backendJobId: "j" }) });
    expect(normalizeEntryOnLoad(resumable).generationStatus).toBe("generating");
    const failed = base({ generationStatus: "failed: boom" }); // failed always survives load (visible error)
    expect(normalizeEntryOnLoad(failed).generationStatus).toBe("failed: boom");
  });
  it("normalizeEntryForSave keeps transcribing (persisted, unlike preparing)", () => {
    const transcribing = base({ generationStatus: "transcribing" });
    expect(normalizeEntryForSave(transcribing).generationStatus).toBe("transcribing");
  });
  it("normalizeEntryOnLoad clears a stuck transcribing status (no backendJobId → the generic stuck-reset)", () => {
    const stuck = base({ generationStatus: "transcribing" }); // no backendJobId: transcribed entries never carry one
    expect(normalizeEntryOnLoad(stuck).generationStatus).toBeUndefined();
  });
});
