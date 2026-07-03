import { z } from "zod";
import type { ToolContext, ToolResult, ToolSpec } from "./types.js";
import { ok, errorResult } from "./executor.js";

// MCP-catalog-only project navigation (#238, ADAPTED — see task-1-brief). Ported from Swift
// ToolExecutor+Projects.swift + the get_projects/open_project/new_project ToolDefinitions entries;
// message text is Swift-verbatim where the adaptation (in-place switching, single window, desktop
// only) doesn't change the semantics. ctx.projects is the desktop-only facade (types.ts); its
// absence (web, or the in-app agent's context) is the one case these tools handle themselves.

const FACADE_ABSENT = "project navigation is only available over MCP on desktop";

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function basename(p: string): string {
  return p.split(/[\\/]/).filter(Boolean).pop() ?? p;
}

// Mirrors NSString.expandingTildeInPath for the "~" and "~/..." forms Swift's resolveProjectURL
// handles; a bare "~" or "~user" prefix elsewhere in the string is left alone, same as Swift.
function expandTilde(p: string): string {
  if (p === "~") return process.env.HOME ?? process.env.USERPROFILE ?? p;
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    const home = process.env.HOME ?? process.env.USERPROFILE;
    return home ? home + p.slice(1) : p;
  }
  return p;
}

function samePath(a: string, b: string): boolean {
  return a.replace(/\\/g, "/").replace(/\/+$/, "") === b.replace(/\\/g, "/").replace(/\/+$/, "");
}

export function getProjectsTool(): ToolSpec {
  return {
    name: "get_projects",
    description:
      "List the user's known projects, most recently opened first: each entry's id, name, path, whether it's currently open, and whether it's the active project (the one editing tools act on). Also returns a top-level `active` (name, path) for the current project, which may not appear in the list. Call this to discover what's available before open_project, or to find out which project is active. Takes no arguments.",
    inputSchema: z.object({}),
    async run(_args, ctx): Promise<ToolResult> {
      const facade = ctx.projects;
      if (!facade) return errorResult(FACADE_ABSENT);
      const { projects, active } = await facade.list();
      const payload: Record<string, unknown> = { openCount: active ? 1 : 0, projects };
      if (active) payload.active = active;
      return ok(JSON.stringify(payload));
    },
  };
}

interface OpenProjectArgs {
  id?: string;
  path?: string;
}

export function openProjectTool(): ToolSpec {
  return {
    name: "open_project",
    description:
      "Open a project and make it the active one — every editing tool then acts on it. Identify it by `id` (from get_projects) or by `path` to a project folder. If it's already active, this is a no-op. The current project is saved first if it has unsaved changes. The user sees the window change.",
    inputSchema: z.object({
      // Loose strings, not required/exclusive in the schema — "exactly one" is enforced in run()
      // so the Swift-verbatim messages below survive ToolExecutor's safeParse gate (#242 review H2).
      id: z.string().optional(),
      path: z.string().optional(),
    }),
    async run(args, ctx): Promise<ToolResult> {
      const facade = ctx.projects;
      if (!facade) return errorResult(FACADE_ABSENT);

      const { id, path } = args as OpenProjectArgs;
      const hasId = id !== undefined && id !== "";
      const hasPath = path !== undefined && path !== "";
      if (hasId && hasPath) return errorResult("open_project: provide either id or path, not both.");
      if (!hasId && !hasPath) return errorResult("open_project needs an id (from get_projects) or a path.");

      if (hasId) {
        const { projects } = await facade.list();
        const entry = projects.find((p) => p.id === id);
        if (!entry) return errorResult(`No project with id ${id}. Call get_projects for valid ids.`);
        if (entry.isActive) return ok(`“${entry.name}” is already active.`);
        try {
          await facade.openById(id!);
        } catch (err) {
          return errorResult(toMessage(err));
        }
        return ok(`Now editing “${entry.name}”. 1 project open.`);
      }

      const resolvedPath = expandTilde(path!);
      const activePath = facade.activePath();
      if (activePath !== undefined && samePath(activePath, resolvedPath)) {
        return ok(`“${basename(resolvedPath)}” is already active.`);
      }
      try {
        await facade.openByPath(resolvedPath);
      } catch (err) {
        return errorResult(toMessage(err));
      }
      return ok(`Now editing “${basename(resolvedPath)}”. 1 project open.`);
    },
  };
}

interface NewProjectArgs {
  name?: string;
}

export function newProjectTool(): ToolSpec {
  return {
    name: "new_project",
    description:
      "Create a new empty project in the user's Palmier Pro folder and make it active. Fails if a project with that name already exists — pick another name. The current project is saved first if it has unsaved changes. Returns the new project's name and path.",
    inputSchema: z.object({
      name: z.string().optional(),
    }),
    async run(args, ctx): Promise<ToolResult> {
      const facade = ctx.projects;
      if (!facade) return errorResult(FACADE_ABSENT);

      const { name } = args as NewProjectArgs;
      const requested = name ?? "Untitled Project";
      try {
        const { path } = await facade.create(requested);
        return ok(`Created and now editing “${basename(path)}” at ${path}.`);
      } catch (err) {
        return errorResult(toMessage(err));
      }
    },
  };
}
