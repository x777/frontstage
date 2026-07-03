import { describe, expect, test, vi } from "vitest";
import { createDesktopProjectNav } from "../src/renderer/desktop-project-nav.js";
import type { DesktopProjectNavBridge, ProjectNavSession } from "../src/renderer/desktop-project-nav.js";
import type { DesktopProjectRef } from "../src/renderer/desktop-gateway.js";

// desktop-project-nav.ts is deliberately fully-injected (session + nav bridge, no window.* reads)
// so the M13B final-review seams — H-1 (restore-on-failed-create), M-1 (no-picker-hang guard), and
// H-2 (authorize-nonce threading) — are unit-testable without an Electron preload.

const ALPHA: DesktopProjectRef = { id: "alpha", name: "Alpha", path: "/projects/Alpha" };

// A mock ProjectSession that models the real one's destructive-reset semantics closely enough to
// exercise H-1's ordering bug: newProject() actually mutates `ref` to null before saveAs runs.
function makeSession(initial: { ref: DesktopProjectRef | null; name: string; dirty?: boolean }) {
  let ref = initial.ref;
  let name = initial.name;
  let dirty = initial.dirty ?? false;
  let saveAsImpl: (r: DesktopProjectRef) => Promise<boolean> = async (r) => {
    ref = r;
    name = r.name;
    dirty = false;
    return true;
  };

  const save = vi.fn(async () => {
    dirty = false;
    return true;
  });
  const newProject = vi.fn(async (_confirm: () => Promise<boolean>) => {
    ref = null;
    name = "Untitled";
    dirty = false;
    return true;
  });
  const saveAs = vi.fn(async (r: DesktopProjectRef) => saveAsImpl(r));
  const open = vi.fn(async (_confirm: () => Promise<boolean>, r?: DesktopProjectRef) => {
    if (r) {
      ref = r;
      name = r.name;
    }
    dirty = false;
    return true;
  });

  const session: ProjectNavSession = {
    isDirty: () => dirty,
    getState: () => ({ ref, name }),
    save,
    newProject,
    saveAs,
    open,
  };

  return {
    session,
    spies: { save, newProject, saveAs, open },
    setDirty: (v: boolean) => { dirty = v; },
    setSaveAsImpl: (fn: (r: DesktopProjectRef) => Promise<boolean>) => { saveAsImpl = fn; },
    currentRef: () => ref,
  };
}

function makeNav(overrides: Partial<DesktopProjectNavBridge> = {}): DesktopProjectNavBridge {
  return {
    list: vi.fn(async () => []),
    resolve: vi.fn(async () => null),
    create: vi.fn(async (name: string) => ({ path: `/projects/${name}` })),
    upsert: vi.fn(async (p: string, n: string) => ({ id: "new-id", name: n, path: p, lastOpenedAt: "2026-01-01T00:00:00.000Z" })),
    authorizePath: vi.fn(async (p: string) => ({ path: p })),
    cleanupFailedCreate: vi.fn(async () => ({ ok: true as const })),
    ...overrides,
  };
}

describe("H-1: createProjectByName restores the previous project on a late saveAs failure", () => {
  test("saveAs throws after newProject's destructive reset -> orphaned dir cleaned up, previous project restored", async () => {
    const { session, spies } = makeSession({ ref: ALPHA, name: "Alpha", dirty: false });
    spies.saveAs.mockImplementation(async () => { throw new Error("disk full"); });
    const nav = makeNav();

    const { facade } = createDesktopProjectNav(session, nav);

    await expect(facade.create("New")).rejects.toThrow("disk full");

    // The reset actually happened (ref went to null) before saveAs failed — proves the previous
    // ref was captured BEFORE the destructive reset, not read after it (which would be null).
    expect(nav.cleanupFailedCreate).toHaveBeenCalledWith("/projects/New");
    expect(spies.open).toHaveBeenCalledTimes(1);
    expect(spies.open).toHaveBeenCalledWith(expect.any(Function), ALPHA);
  });

  test("no previous project (fresh blank Untitled) -> cleanup runs, but no restore call", async () => {
    const { session, spies } = makeSession({ ref: null, name: "Untitled", dirty: false });
    spies.saveAs.mockImplementation(async () => { throw new Error("permission denied"); });
    const nav = makeNav();

    const { facade } = createDesktopProjectNav(session, nav);

    await expect(facade.create("New")).rejects.toThrow("permission denied");

    expect(nav.cleanupFailedCreate).toHaveBeenCalledWith("/projects/New");
    expect(spies.open).not.toHaveBeenCalled();
  });

  test("success path is unaffected: no cleanup, no restore, upsert runs", async () => {
    const { session, spies } = makeSession({ ref: ALPHA, name: "Alpha", dirty: false });
    const nav = makeNav();

    const { facade } = createDesktopProjectNav(session, nav);
    const result = await facade.create("New");

    expect(result).toEqual({ path: "/projects/New" });
    expect(nav.cleanupFailedCreate).not.toHaveBeenCalled();
    expect(spies.open).not.toHaveBeenCalled();
    expect(nav.upsert).toHaveBeenCalledWith("/projects/New", "New");
  });

  test("newProject() itself declining (returns false) still cleans up and restores", async () => {
    const { session, spies } = makeSession({ ref: ALPHA, name: "Alpha", dirty: false });
    spies.newProject.mockImplementation(async () => false);
    const nav = makeNav();

    const { facade } = createDesktopProjectNav(session, nav);

    await expect(facade.create("New")).rejects.toThrow("Couldn't reset the current project before creating a new one.");
    expect(nav.cleanupFailedCreate).toHaveBeenCalledWith("/projects/New");
    expect(spies.open).toHaveBeenCalledWith(expect.any(Function), ALPHA);
  });

  test("a failing restore doesn't mask the original saveAs error, and cleanup still ran", async () => {
    const { session, spies } = makeSession({ ref: ALPHA, name: "Alpha", dirty: false });
    spies.saveAs.mockImplementation(async () => { throw new Error("disk full"); });
    spies.open.mockImplementation(async () => { throw new Error("Alpha is no longer accessible"); });
    const nav = makeNav();

    const { facade } = createDesktopProjectNav(session, nav);

    await expect(facade.create("New")).rejects.toThrow("disk full");
    expect(nav.cleanupFailedCreate).toHaveBeenCalledWith("/projects/New");
  });

  test("projects:create itself failing (name taken) never reaches newProject/saveAs at all", async () => {
    const { session, spies } = makeSession({ ref: ALPHA, name: "Alpha", dirty: false });
    const nav = makeNav({ create: vi.fn(async () => ({ error: "A project named “New” already exists in that folder. Pick another name." })) });

    const { facade } = createDesktopProjectNav(session, nav);

    await expect(facade.create("New")).rejects.toThrow("already exists");
    expect(spies.newProject).not.toHaveBeenCalled();
    expect(nav.cleanupFailedCreate).not.toHaveBeenCalled();
  });
});

describe("M-1: no-picker-hang guard — never-saved dirty project fails fast before any save() call", () => {
  test("dirty + ref === null -> throws the clean error, session.save() is never invoked", async () => {
    const { session, spies } = makeSession({ ref: null, name: "Untitled", dirty: true });
    const nav = makeNav();
    const { facade } = createDesktopProjectNav(session, nav);

    await expect(facade.openByPath("/projects/Other")).rejects.toThrow(
      "The current project has never been saved. Save it before switching projects."
    );
    expect(spies.save).not.toHaveBeenCalled();
    expect(nav.authorizePath).not.toHaveBeenCalled();
  });

  test("new_project's create() path is guarded the same way, before nav.create() is ever called", async () => {
    const { session, spies } = makeSession({ ref: null, name: "Untitled", dirty: true });
    const nav = makeNav();
    const { facade } = createDesktopProjectNav(session, nav);

    await expect(facade.create("X")).rejects.toThrow(
      "The current project has never been saved. Save it before switching projects."
    );
    expect(spies.save).not.toHaveBeenCalled();
    expect(nav.create).not.toHaveBeenCalled();
  });

  test("dirty + has a ref -> save() runs normally (regression guard)", async () => {
    const { session, spies } = makeSession({ ref: ALPHA, name: "Alpha", dirty: true });
    const nav = makeNav();
    const { facade } = createDesktopProjectNav(session, nav);

    await facade.openByPath("/projects/Beta");
    expect(spies.save).toHaveBeenCalledTimes(1);
  });

  test("not dirty -> save() never runs (regression guard)", async () => {
    const { session, spies } = makeSession({ ref: ALPHA, name: "Alpha", dirty: false });
    const nav = makeNav();
    const { facade } = createDesktopProjectNav(session, nav);

    await facade.openByPath("/projects/Beta");
    expect(spies.save).not.toHaveBeenCalled();
  });
});

describe("H-2: authorize-nonce threading", () => {
  test("openByPath forwards the currently-set nonce to nav.authorizePath", async () => {
    const { session } = makeSession({ ref: ALPHA, name: "Alpha", dirty: false });
    const nav = makeNav();
    const { facade, setAuthNonce } = createDesktopProjectNav(session, nav);

    setAuthNonce("nonce-abc");
    await facade.openByPath("/projects/Beta");

    expect(nav.authorizePath).toHaveBeenCalledWith("/projects/Beta", "nonce-abc");
  });

  test("no nonce set -> authorizePath is called with null, not undefined or a stale value", async () => {
    const { session } = makeSession({ ref: ALPHA, name: "Alpha", dirty: false });
    const nav = makeNav();
    const { facade } = createDesktopProjectNav(session, nav);

    await facade.openByPath("/projects/Beta");

    expect(nav.authorizePath).toHaveBeenCalledWith("/projects/Beta", null);
  });

  test("setAuthNonce(null) clears a previously-set nonce for subsequent calls", async () => {
    const { session } = makeSession({ ref: ALPHA, name: "Alpha", dirty: false });
    const nav = makeNav();
    const { facade, setAuthNonce } = createDesktopProjectNav(session, nav);

    setAuthNonce("nonce-1");
    await facade.openByPath("/projects/Beta");
    setAuthNonce(null);
    await facade.openByPath("/projects/Gamma");

    expect(nav.authorizePath).toHaveBeenNthCalledWith(1, "/projects/Beta", "nonce-1");
    expect(nav.authorizePath).toHaveBeenNthCalledWith(2, "/projects/Gamma", null);
  });

  test("openById resolves through nav.resolve then forwards the nonce the same as openByPath", async () => {
    const { session } = makeSession({ ref: ALPHA, name: "Alpha", dirty: false });
    const nav = makeNav({ resolve: vi.fn(async () => "/projects/Beta") });
    const { facade, setAuthNonce } = createDesktopProjectNav(session, nav);

    setAuthNonce("nonce-xyz");
    await facade.openById("beta-id");

    expect(nav.authorizePath).toHaveBeenCalledWith("/projects/Beta", "nonce-xyz");
  });
});

describe("facade wiring regression checks", () => {
  test("activePath reflects the session's current ref", async () => {
    const { session } = makeSession({ ref: ALPHA, name: "Alpha", dirty: false });
    const nav = makeNav();
    const { facade } = createDesktopProjectNav(session, nav);
    expect(facade.activePath()).toBe("/projects/Alpha");
  });

  test("activePath is undefined when no project is open", async () => {
    const { session } = makeSession({ ref: null, name: "Untitled", dirty: false });
    const nav = makeNav();
    const { facade } = createDesktopProjectNav(session, nav);
    expect(facade.activePath()).toBeUndefined();
  });

  test("list() marks the active project by matching path", async () => {
    const { session } = makeSession({ ref: ALPHA, name: "Alpha", dirty: false });
    const nav = makeNav({
      list: vi.fn(async () => [
        { id: "alpha", name: "Alpha", path: "/projects/Alpha", lastOpenedAt: "t", isAccessible: true },
        { id: "beta", name: "Beta", path: "/projects/Beta", lastOpenedAt: "t", isAccessible: true },
      ]),
    });
    const { facade } = createDesktopProjectNav(session, nav);

    const { projects, active } = await facade.list();
    expect(projects.find((p) => p.id === "alpha")?.isActive).toBe(true);
    expect(projects.find((p) => p.id === "beta")?.isActive).toBe(false);
    expect(active).toEqual({ name: "Alpha", path: "/projects/Alpha" });
  });
});
