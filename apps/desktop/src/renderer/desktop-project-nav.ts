import type { ToolContext } from "@palmier/ai";
import { refFor } from "./desktop-gateway.js";
import type { DesktopProjectRef } from "./desktop-gateway.js";

// window.desktopProjectNav's shape (M13B T1 registry bridge over IPC) — injected here rather than
// read from `window` directly so createDesktopProjectNav's restore-on-failed-create (H-1), the
// no-picker-hang guard (M-1), and the authorize-nonce threading (H-2) are all unit-testable
// without an Electron preload (M13B final-review, .superpowers/sdd/m13b-broad-review.md).
export interface DesktopProjectNavBridge {
  list(): Promise<Array<{ id: string; name: string; path: string; lastOpenedAt: string; isAccessible: boolean }>>;
  resolve(id: string): Promise<string | null>;
  create(name: string): Promise<{ path: string } | { error: string }>;
  upsert(projectPath: string, name: string): Promise<{ id: string; name: string; path: string; lastOpenedAt: string }>;
  authorizePath(projectPath: string, nonce: string | null): Promise<{ path: string } | { error: string }>;
  // Removes the orphaned dir projects:create mkdir'd, when a subsequent saveAs fails (H-1) —
  // main-side, restricted to paths under the fixed projects storage dir.
  cleanupFailedCreate(projectPath: string): Promise<{ ok: true } | { error: string }>;
}

// The subset of ProjectSession's API this facade drives — structurally satisfied by the real
// ProjectSession instance (packages/core/src/project/project-session.ts), narrowed here so tests
// can pass a plain mock instead of constructing a real session + host + gateway.
export interface ProjectNavSession {
  isDirty(): boolean;
  getState(): { ref: DesktopProjectRef | null; name: string };
  save(): Promise<boolean>;
  newProject(confirm: () => Promise<boolean>): Promise<boolean>;
  saveAs(ref: DesktopProjectRef): Promise<boolean>;
  open(confirm: () => Promise<boolean>, ref?: DesktopProjectRef): Promise<boolean>;
}

export interface DesktopProjectNav {
  facade: NonNullable<ToolContext["projects"]>;
  // Set by the MCP bridge handler around each callTool dispatch (H-2) — openProjectAtPath's
  // authorizePath call is gated main-side on this being a live, unconsumed nonce, so a pickerless
  // authorize requires an in-flight MCP tool call, not just a call to window.desktopProjectNav.
  setAuthNonce(nonce: string | null): void;
}

// Project navigation facade (M13B T1, get_projects/open_project/new_project) — desktop only, over
// a DesktopProjectNavBridge (the main-process registry) + a ProjectSession (auto-save/open/create-as).
// The "Now editing" chat notice (spec M13B-1) is OMITTED: the chat message model
// (packages/ai/src/agent/conversation.ts) has no display-only row kind — role is a closed
// "user" | "assistant" | "tool" union — so there's nowhere to post a notice excluded from model
// context without inventing one. Approved deviation, recorded in task-1-report.md.
export function createDesktopProjectNav(session: ProjectNavSession, nav: DesktopProjectNavBridge): DesktopProjectNav {
  let authNonce: string | null = null;

  function setAuthNonce(nonce: string | null): void {
    authNonce = nonce;
  }

  // M-1: a never-saved, dirty project has ref === null, so ProjectSession.save() would fall
  // through to saveAs()'s interactive native picker — fatal for a headless MCP caller (it hangs
  // with no timeout and no indication of what's blocking it). Fail fast instead, before any save.
  async function autoSaveCurrentProject(): Promise<void> {
    if (!session.isDirty()) return;
    if (session.getState().ref === null) {
      throw new Error("The current project has never been saved. Save it before switching projects.");
    }
    const saved = await session.save();
    if (!saved) throw new Error("Couldn't save the current project before switching.");
  }

  async function openProjectAtPath(targetPath: string): Promise<void> {
    await autoSaveCurrentProject();
    const authorized = await nav.authorizePath(targetPath, authNonce);
    if ("error" in authorized) throw new Error(authorized.error);
    const ref = refFor(authorized.path);
    const opened = await session.open(async () => true, ref);
    if (!opened) throw new Error(`No project at ${authorized.path}.`);
    await nav.upsert(ref.path, ref.name);
  }

  async function openProjectById(id: string): Promise<void> {
    const target = await nav.resolve(id);
    if (!target) throw new Error(`No project with id ${id}. Call get_projects for valid ids.`);
    await openProjectAtPath(target);
  }

  // H-1: session.newProject() destructively resets in-memory state before saveAs() can even run,
  // so a late saveAs failure (disk full, permission denied, a media-copy I/O error) used to strand
  // the app on a blank Untitled with an orphaned on-disk dir. Capture the previous project BEFORE
  // the reset; on failure, clean up the orphaned dir and restore the previous project (or the
  // pre-create blank state, if there wasn't one) — mirrors Swift's AppState.createProject.
  async function createProjectByName(name: string): Promise<{ path: string }> {
    await autoSaveCurrentProject();
    const previousRef = session.getState().ref;
    const created = await nav.create(name);
    if ("error" in created) throw new Error(created.error);
    const ref = refFor(created.path);
    try {
      const reset = await session.newProject(async () => true);
      if (!reset) throw new Error("Couldn't reset the current project before creating a new one.");
      const saved = await session.saveAs(ref);
      if (!saved) throw new Error(`Couldn't create the project at ${created.path}.`);
    } catch (err) {
      await nav.cleanupFailedCreate(created.path).catch(() => undefined);
      if (previousRef) await session.open(async () => true, previousRef).catch(() => undefined);
      throw err;
    }
    await nav.upsert(ref.path, ref.name);
    return { path: ref.path };
  }

  async function listProjects(): ReturnType<NonNullable<ToolContext["projects"]>["list"]> {
    const entries = await nav.list();
    const ref = session.getState().ref;
    const projects = entries.map((e) => ({
      id: e.id,
      name: e.name,
      path: e.path,
      isOpen: ref !== null && e.path === ref.path,
      isActive: ref !== null && e.path === ref.path,
      isAccessible: e.isAccessible,
    }));
    const active = ref ? { name: session.getState().name, path: ref.path } : undefined;
    return { projects, active };
  }

  function activeProjectPath(): string | undefined {
    return session.getState().ref?.path;
  }

  return {
    facade: { list: listProjects, openByPath: openProjectAtPath, openById: openProjectById, create: createProjectByName, activePath: activeProjectPath },
    setAuthNonce,
  };
}
