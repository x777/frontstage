import { describe, expect, test } from "vitest";
import { EditorStore, defaultTimeline, type MediaManifest } from "@frontstage/core";
import { buildCatalog, ToolExecutor, readSkillTool, type ToolContext } from "../src/index.js";

type SkillsFacade = NonNullable<ToolContext["skills"]>;

function makeManifest(): MediaManifest {
  return { version: 2, entries: [], folders: [] };
}

function makeCtx(skills?: SkillsFacade): ToolContext {
  return {
    store: new EditorStore(defaultTimeline()),
    getManifest: makeManifest,
    newId: () => "gen-1",
    skills,
  };
}

function makeExecutor(skills?: SkillsFacade): ToolExecutor {
  return new ToolExecutor(buildCatalog("inApp"), makeCtx(skills));
}

describe("read_skill — through the ToolExecutor", () => {
  test("facade absent -> a clean in-app-only error", async () => {
    const executor = makeExecutor(undefined);
    const result = await executor.execute("read_skill", { id: "foo" });
    expect(result.isError).toBe(true);
    expect(result.blocks[0]).toEqual({ kind: "text", text: "read_skill is only available to the in-app agent." });
  });

  test("missing id -> the Swift-verbatim error", async () => {
    const executor = makeExecutor({ body: () => "unused" });
    const result = await executor.execute("read_skill", {});
    expect(result.isError).toBe(true);
    expect(result.blocks[0]).toEqual({ kind: "text", text: "read_skill requires an 'id'." });
  });

  test("unknown id -> the Swift-verbatim error", async () => {
    const executor = makeExecutor({ body: () => undefined });
    const result = await executor.execute("read_skill", { id: "nope" });
    expect(result.isError).toBe(true);
    expect(result.blocks[0]).toEqual({ kind: "text", text: "Unknown skill: nope" });
  });

  test("exact-id match -> returns the body verbatim", async () => {
    const executor = makeExecutor({ body: (id) => (id === "my-skill" ? "the full procedure" : undefined) });
    const result = await executor.execute("read_skill", { id: "my-skill" });
    expect(result.isError).toBe(false);
    expect(result.blocks[0]).toEqual({ kind: "text", text: "the full procedure" });
  });

  test("id must match exactly — no partial/case-insensitive lookup", async () => {
    const executor = makeExecutor({ body: (id) => (id === "my-skill" ? "body" : undefined) });
    const result = await executor.execute("read_skill", { id: "My-Skill" });
    expect(result.isError).toBe(true);
    expect(result.blocks[0]).toEqual({ kind: "text", text: "Unknown skill: My-Skill" });
  });
});

describe("read_skill — description is Swift-verbatim", () => {
  test("exact text", () => {
    expect(readSkillTool().description).toBe(
      "Load the full instructions for one of the skills listed under # Skills in your system prompt. Call this before starting a task that matches a skill's description, then follow the returned procedure. Pass the id exactly as listed.",
    );
  });
});

describe("catalog registration — inApp 41 / mcp 43 (M15 T1)", () => {
  test("buildCatalog('inApp') (and the default) includes read_skill, length 41", () => {
    expect(buildCatalog().map((s) => s.name)).toContain("read_skill");
    expect(buildCatalog()).toHaveLength(41);
    expect(buildCatalog("inApp")).toHaveLength(41);
  });

  test("buildCatalog('mcp') never includes read_skill, length stays 43", () => {
    const names = buildCatalog("mcp").map((s) => s.name);
    expect(names).not.toContain("read_skill");
    expect(buildCatalog("mcp")).toHaveLength(43);
  });
});
