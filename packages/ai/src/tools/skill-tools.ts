import { z } from "zod";
import type { ToolResult, ToolSpec } from "./types.js";
import { ok, errorResult } from "./executor.js";

// In-app-agent-only (ToolDefinitions.swift's readSkill + ToolExecutor.swift:134-142). Registered
// only in buildCatalog("inApp") — never "mcp" (catalog.ts). Facade-absence is a TS-only concern
// (Swift's SkillStore.shared is always present); its message is not Swift text.

const FACADE_ABSENT = "read_skill is only available to the in-app agent.";

interface ReadSkillArgs {
  id?: string;
}

export function readSkillTool(): ToolSpec {
  return {
    name: "read_skill",
    description:
      "Load the full instructions for one of the skills listed under # Skills in your system prompt. Call this before starting a task that matches a skill's description, then follow the returned procedure. Pass the id exactly as listed.",
    inputSchema: z.object({
      // Left optional in the schema (not required) so the Swift-verbatim message below survives
      // ToolExecutor's safeParse gate, mirroring project-tools.ts's open_project/new_project.
      id: z.string().optional(),
    }),
    run(args, ctx): ToolResult {
      const facade = ctx.skills;
      if (!facade) return errorResult(FACADE_ABSENT);

      const { id } = args as ReadSkillArgs;
      if (!id) return errorResult("read_skill requires an 'id'.");

      const body = facade.body(id);
      if (body === undefined) return errorResult(`Unknown skill: ${id}`);
      return ok(body);
    },
  };
}
