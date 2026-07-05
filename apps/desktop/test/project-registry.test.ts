import { describe, expect, test, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  registryFilePath,
  loadRegistry,
  registryList,
  registryResolve,
  registryUpsert,
  validateProjectName,
  REGISTRY_FILENAME,
  DEFAULT_PROJECT_NAME,
} from "../src/main/project-registry.mjs";

// project-registry.mjs takes no `electron` dependency (every function is given userDataDir
// explicitly), so it loads under plain Node/vitest the same way index.cjs loads it via
// dynamic import() — mirrors apps/web's convention of unit-testing only the electron-free logic.

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "frontstage-registry-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("registryFilePath", () => {
  test("joins userDataDir with the registry filename", () => {
    expect(registryFilePath("/x/y")).toBe(path.join("/x/y", REGISTRY_FILENAME));
  });
});

describe("loadRegistry", () => {
  test("missing file -> empty array", () => {
    expect(loadRegistry(dir)).toEqual([]);
  });

  test("malformed JSON -> empty array", () => {
    fs.writeFileSync(registryFilePath(dir), "{ not json");
    expect(loadRegistry(dir)).toEqual([]);
  });

  test("non-array JSON -> empty array", () => {
    fs.writeFileSync(registryFilePath(dir), JSON.stringify({ foo: "bar" }));
    expect(loadRegistry(dir)).toEqual([]);
  });

  test("filters out malformed entries, keeps valid ones", () => {
    fs.writeFileSync(
      registryFilePath(dir),
      JSON.stringify([
        { id: "a", name: "A", path: "/a", lastOpenedAt: "2026-01-01T00:00:00.000Z" },
        { id: "b" }, // missing fields
        "not an object",
      ]),
    );
    const loaded = loadRegistry(dir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.id).toBe("a");
  });
});

describe("registryUpsert", () => {
  test("inserts a new entry with a generated id and persists to disk", () => {
    const entry = registryUpsert(dir, "/projects/Alpha", "Alpha");
    expect(entry.name).toBe("Alpha");
    expect(entry.path).toBe(path.resolve("/projects/Alpha"));
    expect(typeof entry.id).toBe("string");
    expect(entry.id.length).toBeGreaterThan(0);

    const reloaded = loadRegistry(dir);
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0]).toEqual(entry);
  });

  test("re-upserting the same (resolved) path keeps the id, refreshes name + lastOpenedAt", async () => {
    const first = registryUpsert(dir, "/projects/Alpha", "Alpha");
    await new Promise((r) => setTimeout(r, 5));
    const second = registryUpsert(dir, "/projects/Alpha", "Alpha Renamed");

    expect(second.id).toBe(first.id);
    expect(second.name).toBe("Alpha Renamed");
    expect(second.lastOpenedAt >= first.lastOpenedAt).toBe(true);
    expect(loadRegistry(dir)).toHaveLength(1);
  });

  test("distinct paths produce distinct entries", () => {
    registryUpsert(dir, "/projects/Alpha", "Alpha");
    registryUpsert(dir, "/projects/Beta", "Beta");
    expect(loadRegistry(dir)).toHaveLength(2);
  });
});

describe("registryList", () => {
  test("sorts most-recently-opened first", async () => {
    registryUpsert(dir, "/projects/Alpha", "Alpha");
    await new Promise((r) => setTimeout(r, 5));
    registryUpsert(dir, "/projects/Beta", "Beta");
    await new Promise((r) => setTimeout(r, 5));
    registryUpsert(dir, "/projects/Alpha", "Alpha"); // re-touch Alpha -> most recent

    const names = registryList(dir).map((e) => e.name);
    expect(names).toEqual(["Alpha", "Beta"]);
  });
});

describe("registryResolve", () => {
  test("resolves a known id to its entry", () => {
    const entry = registryUpsert(dir, "/projects/Alpha", "Alpha");
    expect(registryResolve(dir, entry.id)).toEqual(entry);
  });

  test("unknown id -> null", () => {
    expect(registryResolve(dir, "nonexistent")).toBeNull();
  });
});

describe("validateProjectName", () => {
  test("a plain name is valid", () => {
    expect(validateProjectName("My Reel")).toEqual({ ok: true, name: "My Reel" });
  });

  test("trims whitespace", () => {
    expect(validateProjectName("  My Reel  ")).toEqual({ ok: true, name: "My Reel" });
  });

  test("empty/whitespace-only defaults to the default project name", () => {
    expect(validateProjectName("")).toEqual({ ok: true, name: DEFAULT_PROJECT_NAME });
    expect(validateProjectName("   ")).toEqual({ ok: true, name: DEFAULT_PROJECT_NAME });
    expect(validateProjectName(undefined)).toEqual({ ok: true, name: DEFAULT_PROJECT_NAME });
  });

  test("rejects a forward slash", () => {
    expect(validateProjectName("a/b")).toEqual({ ok: false, name: "a/b" });
  });

  test("rejects a backslash", () => {
    expect(validateProjectName("a\\b")).toEqual({ ok: false, name: "a\\b" });
  });

  test("rejects '.' and '..'", () => {
    expect(validateProjectName(".")).toEqual({ ok: false, name: "." });
    expect(validateProjectName("..")).toEqual({ ok: false, name: ".." });
  });

  test("a name containing dots elsewhere is fine", () => {
    expect(validateProjectName("v1.2 Final")).toEqual({ ok: true, name: "v1.2 Final" });
  });
});
