import { describe, expect, test, vi } from "vitest";
import { EditorStore, defaultTimeline, type MediaManifest } from "@frontstage/core";
import { buildCatalog, ToolExecutor, type ToolContext } from "../src/index.js";

type ProjectsFacade = NonNullable<ToolContext["projects"]>;
type ListResult = Awaited<ReturnType<ProjectsFacade["list"]>>;

function makeManifest(): MediaManifest {
  return { version: 2, entries: [], folders: [] };
}

function makeCtx(projects?: ProjectsFacade): ToolContext {
  return {
    store: new EditorStore(defaultTimeline()),
    getManifest: makeManifest,
    newId: () => "gen-1",
    projects,
  };
}

function makeExecutor(projects?: ProjectsFacade): ToolExecutor {
  return new ToolExecutor(buildCatalog("mcp"), makeCtx(projects));
}

const ENTRY_A = { id: "id-a", name: "Alpha", path: "/projects/Alpha", isOpen: true, isActive: true, isAccessible: true };
const ENTRY_B = { id: "id-b", name: "Beta", path: "/projects/Beta", isOpen: false, isActive: false, isAccessible: true };

function listResult(active?: { name: string; path: string }): ListResult {
  return { projects: [ENTRY_A, ENTRY_B], active };
}

// A mock facade that models the desktop implementation's real internal sequencing (auto-save
// THEN open) as two separate spies, so a save failure can be asserted to short-circuit before any
// open ever happens — even though ToolContext.projects only exposes the single bundled method.
function makeSaveThenOpenFacade(opts: { saveOk: boolean }) {
  const saveSpy = vi.fn();
  const openSpy = vi.fn();
  const openByPath = vi.fn(async (path: string) => {
    saveSpy();
    if (!opts.saveOk) throw new Error("Couldn't save the current project before switching.");
    openSpy(path);
  });
  return { saveSpy, openSpy, openByPath };
}

describe("get_projects", () => {
  test("facade absent -> error", async () => {
    const executor = makeExecutor(undefined);
    const result = await executor.execute("get_projects", {});
    expect(result.isError).toBe(true);
    expect(result.blocks[0]).toEqual({ kind: "text", text: "project navigation is only available over MCP on desktop" });
  });

  test("returns the facade's list() shape as JSON, with active", async () => {
    const active = { name: "Alpha", path: "/projects/Alpha" };
    const projects: ProjectsFacade = {
      list: vi.fn(async () => listResult(active)),
      openByPath: vi.fn(),
      openById: vi.fn(),
      create: vi.fn(),
      activePath: () => "/projects/Alpha",
    };
    const executor = makeExecutor(projects);
    const result = await executor.execute("get_projects", {});
    expect(result.isError).toBe(false);
    const text = result.blocks[0]!.kind === "text" ? result.blocks[0]!.text : "";
    const parsed = JSON.parse(text);
    expect(parsed).toEqual({ openCount: 1, projects: [ENTRY_A, ENTRY_B], active });
  });

  test("no active project -> openCount 0, active omitted", async () => {
    const projects: ProjectsFacade = {
      list: vi.fn(async () => listResult(undefined)),
      openByPath: vi.fn(),
      openById: vi.fn(),
      create: vi.fn(),
      activePath: () => undefined,
    };
    const executor = makeExecutor(projects);
    const result = await executor.execute("get_projects", {});
    const text = result.blocks[0]!.kind === "text" ? result.blocks[0]!.text : "";
    const parsed = JSON.parse(text);
    expect(parsed.openCount).toBe(0);
    expect(parsed).not.toHaveProperty("active");
  });
});

describe("open_project", () => {
  test("facade absent -> error", async () => {
    const executor = makeExecutor(undefined);
    const result = await executor.execute("open_project", { path: "/x" });
    expect(result.isError).toBe(true);
    expect(result.blocks[0]).toEqual({ kind: "text", text: "project navigation is only available over MCP on desktop" });
  });

  test("neither id nor path -> Swift-verbatim error, no facade calls", async () => {
    const list = vi.fn();
    const projects: ProjectsFacade = { list, openByPath: vi.fn(), openById: vi.fn(), create: vi.fn(), activePath: () => undefined };
    const executor = makeExecutor(projects);
    const result = await executor.execute("open_project", {});
    expect(result.isError).toBe(true);
    expect(result.blocks[0]).toEqual({ kind: "text", text: "open_project needs an id (from get_projects) or a path." });
    expect(list).not.toHaveBeenCalled();
  });

  test("both id and path -> exactly-one error, no facade calls", async () => {
    const list = vi.fn();
    const projects: ProjectsFacade = { list, openByPath: vi.fn(), openById: vi.fn(), create: vi.fn(), activePath: () => undefined };
    const executor = makeExecutor(projects);
    const result = await executor.execute("open_project", { id: "id-a", path: "/x" });
    expect(result.isError).toBe(true);
    expect(result.blocks[0]).toEqual({ kind: "text", text: "open_project: provide either id or path, not both." });
    expect(list).not.toHaveBeenCalled();
  });

  test("unknown id -> Swift-verbatim not-found error", async () => {
    const projects: ProjectsFacade = {
      list: vi.fn(async () => listResult()),
      openByPath: vi.fn(),
      openById: vi.fn(),
      create: vi.fn(),
      activePath: () => undefined,
    };
    const executor = makeExecutor(projects);
    const result = await executor.execute("open_project", { id: "nope" });
    expect(result.isError).toBe(true);
    expect(result.blocks[0]).toEqual({ kind: "text", text: "No project with id nope. Call get_projects for valid ids." });
    expect(projects.openById).not.toHaveBeenCalled();
  });

  test("already-active by id -> no-op, openById not called", async () => {
    const projects: ProjectsFacade = {
      list: vi.fn(async () => listResult()),
      openByPath: vi.fn(),
      openById: vi.fn(),
      create: vi.fn(),
      activePath: () => undefined,
    };
    const executor = makeExecutor(projects);
    const result = await executor.execute("open_project", { id: "id-a" });
    expect(result.isError).toBe(false);
    expect(result.blocks[0]).toEqual({ kind: "text", text: "“Alpha” is already active." });
    expect(projects.openById).not.toHaveBeenCalled();
  });

  test("already-active by path -> no-op, openByPath not called", async () => {
    const projects: ProjectsFacade = {
      list: vi.fn(async () => listResult()),
      openByPath: vi.fn(),
      openById: vi.fn(),
      create: vi.fn(),
      activePath: () => "/projects/Alpha",
    };
    const executor = makeExecutor(projects);
    const result = await executor.execute("open_project", { path: "/projects/Alpha" });
    expect(result.isError).toBe(false);
    expect(result.blocks[0]).toEqual({ kind: "text", text: "“Alpha” is already active." });
    expect(projects.openByPath).not.toHaveBeenCalled();
  });

  test("switch by id succeeds", async () => {
    const projects: ProjectsFacade = {
      list: vi.fn(async () => listResult()),
      openByPath: vi.fn(),
      openById: vi.fn(async () => {}),
      create: vi.fn(),
      activePath: () => undefined,
    };
    const executor = makeExecutor(projects);
    const result = await executor.execute("open_project", { id: "id-b" });
    expect(result.isError).toBe(false);
    expect(result.blocks[0]).toEqual({ kind: "text", text: "Now editing “Beta”. 1 project open." });
    expect(projects.openById).toHaveBeenCalledWith("id-b");
  });

  test("switch by path succeeds, and a leading ~ is tilde-expanded before reaching the facade", async () => {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    const openByPath = vi.fn(async () => {});
    const projects: ProjectsFacade = {
      list: vi.fn(async () => listResult()),
      openByPath,
      openById: vi.fn(),
      create: vi.fn(),
      activePath: () => undefined,
    };
    const executor = makeExecutor(projects);
    const result = await executor.execute("open_project", { path: "~/Movies/Reel" });
    expect(result.isError).toBe(false);
    expect(result.blocks[0]).toEqual({ kind: "text", text: "Now editing “Reel”. 1 project open." });
    expect(openByPath).toHaveBeenCalledWith(home + "/Movies/Reel");
  });

  test("nonexistent path -> facade's Swift-verbatim error propagates", async () => {
    const projects: ProjectsFacade = {
      list: vi.fn(async () => listResult()),
      openByPath: vi.fn(async () => { throw new Error("No project at /nope."); }),
      openById: vi.fn(),
      create: vi.fn(),
      activePath: () => undefined,
    };
    const executor = makeExecutor(projects);
    const result = await executor.execute("open_project", { path: "/nope" });
    expect(result.isError).toBe(true);
    expect(result.blocks[0]).toEqual({ kind: "text", text: "No project at /nope." });
  });

  test("the dirty rule: save-fail -> error, and open is never reached", async () => {
    const { saveSpy, openSpy, openByPath } = makeSaveThenOpenFacade({ saveOk: false });
    const projects: ProjectsFacade = {
      list: vi.fn(async () => listResult()),
      openByPath,
      openById: vi.fn(),
      create: vi.fn(),
      activePath: () => undefined,
    };
    const executor = makeExecutor(projects);
    const result = await executor.execute("open_project", { path: "/projects/Gamma" });
    expect(result.isError).toBe(true);
    expect(result.blocks[0]).toEqual({ kind: "text", text: "Couldn't save the current project before switching." });
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).not.toHaveBeenCalled();
  });

  test("the dirty rule: save succeeds -> open proceeds", async () => {
    const { saveSpy, openSpy, openByPath } = makeSaveThenOpenFacade({ saveOk: true });
    const projects: ProjectsFacade = {
      list: vi.fn(async () => listResult()),
      openByPath,
      openById: vi.fn(),
      create: vi.fn(),
      activePath: () => undefined,
    };
    const executor = makeExecutor(projects);
    const result = await executor.execute("open_project", { path: "/projects/Gamma" });
    expect(result.isError).toBe(false);
    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(openSpy).toHaveBeenCalledWith("/projects/Gamma");
  });
});

describe("new_project", () => {
  test("facade absent -> error", async () => {
    const executor = makeExecutor(undefined);
    const result = await executor.execute("new_project", {});
    expect(result.isError).toBe(true);
    expect(result.blocks[0]).toEqual({ kind: "text", text: "project navigation is only available over MCP on desktop" });
  });

  test("no name -> defaults to 'Untitled Project'", async () => {
    const create = vi.fn(async (name: string) => ({ path: `/projects/${name}` }));
    const projects: ProjectsFacade = { list: vi.fn(), openByPath: vi.fn(), openById: vi.fn(), create, activePath: () => undefined };
    const executor = makeExecutor(projects);
    const result = await executor.execute("new_project", {});
    expect(result.isError).toBe(false);
    expect(create).toHaveBeenCalledWith("Untitled Project");
    expect(result.blocks[0]).toEqual({
      kind: "text",
      text: "Created and now editing “Untitled Project” at /projects/Untitled Project.",
    });
  });

  test("custom name is passed through to the facade", async () => {
    const create = vi.fn(async (name: string) => ({ path: `/projects/${name}` }));
    const projects: ProjectsFacade = { list: vi.fn(), openByPath: vi.fn(), openById: vi.fn(), create, activePath: () => undefined };
    const executor = makeExecutor(projects);
    const result = await executor.execute("new_project", { name: "My Reel" });
    expect(result.isError).toBe(false);
    expect(create).toHaveBeenCalledWith("My Reel");
    expect(result.blocks[0]).toEqual({ kind: "text", text: "Created and now editing “My Reel” at /projects/My Reel." });
  });

  test("nameTaken -> the facade's Swift-verbatim error propagates", async () => {
    const create = vi.fn(async () => {
      throw new Error("A project named “My Reel” already exists in that folder. Pick another name.");
    });
    const projects: ProjectsFacade = { list: vi.fn(), openByPath: vi.fn(), openById: vi.fn(), create, activePath: () => undefined };
    const executor = makeExecutor(projects);
    const result = await executor.execute("new_project", { name: "My Reel" });
    expect(result.isError).toBe(true);
    expect(result.blocks[0]).toEqual({
      kind: "text",
      text: "A project named “My Reel” already exists in that folder. Pick another name.",
    });
  });

  test("invalid name ('..') -> the facade's Swift-verbatim error propagates", async () => {
    const create = vi.fn(async () => {
      throw new Error("“..” isn't a valid project name. Use a plain name without slashes or path components.");
    });
    const projects: ProjectsFacade = { list: vi.fn(), openByPath: vi.fn(), openById: vi.fn(), create, activePath: () => undefined };
    const executor = makeExecutor(projects);
    const result = await executor.execute("new_project", { name: ".." });
    expect(result.isError).toBe(true);
    expect(result.blocks[0]).toEqual({
      kind: "text",
      text: "“..” isn't a valid project name. Use a plain name without slashes or path components.",
    });
  });

  test("the dirty rule: save-fail -> error surfaces (create bundles save-then-scaffold)", async () => {
    const saveSpy = vi.fn();
    const create = vi.fn(async () => {
      saveSpy();
      throw new Error("Couldn't save the current project before switching.");
    });
    const projects: ProjectsFacade = { list: vi.fn(), openByPath: vi.fn(), openById: vi.fn(), create, activePath: () => undefined };
    const executor = makeExecutor(projects);
    const result = await executor.execute("new_project", { name: "X" });
    expect(result.isError).toBe(true);
    expect(result.blocks[0]).toEqual({ kind: "text", text: "Couldn't save the current project before switching." });
    expect(saveSpy).toHaveBeenCalledTimes(1);
  });
});
