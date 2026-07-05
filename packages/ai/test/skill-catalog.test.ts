import { describe, expect, test, vi } from "vitest";
import { SkillCatalog, type SkillCatalogEntry } from "../src/index.js";

const ENTRIES: SkillCatalogEntry[] = [
  { id: "foo", name: "Foo", description: "does foo", sha: "sha-foo", path: "skills/foo/SKILL.md" },
  { id: "bar", name: "Bar", description: "does bar", sha: "sha-bar", path: "skills/bar/SKILL.md" },
];

function makeDeps(opts?: { cached?: string | null; baseUrl?: string }) {
  let cache: string | null = opts?.cached ?? null;
  const fetchText = vi.fn(async (_url: string) => JSON.stringify(ENTRIES));
  const cacheRead = vi.fn(async () => cache);
  const cacheWrite = vi.fn(async (s: string) => {
    cache = s;
  });
  return { fetchText, cacheRead, cacheWrite, baseUrl: opts?.baseUrl };
}

describe("SkillCatalog — loadCached (cache-first, no network)", () => {
  test("returns the cached entries without ever calling fetchText", async () => {
    const deps = makeDeps({ cached: JSON.stringify(ENTRIES) });
    const catalog = new SkillCatalog(deps);
    const entries = await catalog.loadCached();
    expect(entries).toEqual(ENTRIES);
    expect(deps.fetchText).not.toHaveBeenCalled();
  });

  test("no cache present -> empty array, no throw", async () => {
    const deps = makeDeps({ cached: null });
    const catalog = new SkillCatalog(deps);
    const entries = await catalog.loadCached();
    expect(entries).toEqual([]);
  });

  test("malformed cache JSON -> swallowed, does not throw, entries stay empty", async () => {
    const deps = makeDeps({ cached: "{not valid json" });
    const catalog = new SkillCatalog(deps);
    await expect(catalog.loadCached()).resolves.toEqual([]);
  });
});

describe("SkillCatalog — refresh", () => {
  test("fetches catalog.json from the default frontstage-skills raw base", async () => {
    const deps = makeDeps();
    const catalog = new SkillCatalog(deps);
    const entries = await catalog.refresh();
    expect(entries).toEqual(ENTRIES);
    expect(deps.fetchText).toHaveBeenCalledWith(
      "https://raw.githubusercontent.com/x777/frontstage-skills/main/catalog.json",
    );
  });

  test("writes the raw fetched text to the cache", async () => {
    const deps = makeDeps();
    const catalog = new SkillCatalog(deps);
    await catalog.refresh();
    expect(deps.cacheWrite).toHaveBeenCalledWith(JSON.stringify(ENTRIES));
  });

  test("overwrites stale loadCached() data", async () => {
    const stale: SkillCatalogEntry[] = [{ id: "stale", name: "Stale", description: "old", sha: "old", path: "x" }];
    const deps = makeDeps({ cached: JSON.stringify(stale) });
    const catalog = new SkillCatalog(deps);
    expect(await catalog.loadCached()).toEqual(stale);
    const refreshed = await catalog.refresh();
    expect(refreshed).toEqual(ENTRIES);
  });

  test("baseUrl override changes the fetched URL", async () => {
    const deps = makeDeps({ baseUrl: "https://example.test/mirror" });
    const catalog = new SkillCatalog(deps);
    await catalog.refresh();
    expect(deps.fetchText).toHaveBeenCalledWith("https://example.test/mirror/catalog.json");
  });
});

describe("SkillCatalog — shape validation (JSONDecoder parity: reject the whole payload, don't drop-and-continue)", () => {
  test("malformed top-level (an object, not an array) -> refresh() rejects, cache untouched", async () => {
    const deps = makeDeps();
    deps.fetchText.mockImplementation(async () => JSON.stringify({ oops: "not an array" }));
    const catalog = new SkillCatalog(deps);
    await expect(catalog.refresh()).rejects.toThrow();
    expect(deps.cacheWrite).not.toHaveBeenCalled();
  });

  test("an entry with a non-string field -> refresh() rejects", async () => {
    const deps = makeDeps();
    deps.fetchText.mockImplementation(async () =>
      JSON.stringify([{ id: "foo", name: "Foo", description: "does foo", sha: 12345, path: "skills/foo/SKILL.md" }]),
    );
    const catalog = new SkillCatalog(deps);
    await expect(catalog.refresh()).rejects.toThrow();
  });

  test("well-formed entries -> refresh() still succeeds (happy path unaffected by the new guard)", async () => {
    const deps = makeDeps();
    const catalog = new SkillCatalog(deps);
    await expect(catalog.refresh()).resolves.toEqual(ENTRIES);
  });

  test("loadCached() swallows a shape-invalid cache the same way it swallows invalid JSON", async () => {
    const deps = makeDeps({ cached: JSON.stringify({ not: "an array" }) });
    const catalog = new SkillCatalog(deps);
    await expect(catalog.loadCached()).resolves.toEqual([]);
  });

  test("loadCached() swallows an array whose entries are missing a field", async () => {
    const deps = makeDeps({ cached: JSON.stringify([{ id: "foo", name: "Foo" }]) });
    const catalog = new SkillCatalog(deps);
    await expect(catalog.loadCached()).resolves.toEqual([]);
  });
});

describe("SkillCatalog — skillText", () => {
  test("fetches <baseUrl>/<entry.path> and returns the fetched text", async () => {
    const deps = makeDeps();
    deps.fetchText.mockImplementation(async () => "---\nname: Foo\ndescription: does foo\n---\nbody");
    const catalog = new SkillCatalog(deps);
    const text = await catalog.skillText(ENTRIES[0]!);
    expect(deps.fetchText).toHaveBeenCalledWith(
      "https://raw.githubusercontent.com/x777/frontstage-skills/main/skills/foo/SKILL.md",
    );
    expect(text).toBe("---\nname: Foo\ndescription: does foo\n---\nbody");
  });

  test("respects a baseUrl override for the joined path", async () => {
    const deps = makeDeps({ baseUrl: "file:///tmp/frontstage-skills" });
    const catalog = new SkillCatalog(deps);
    await catalog.skillText(ENTRIES[1]!);
    expect(deps.fetchText).toHaveBeenCalledWith("file:///tmp/frontstage-skills/skills/bar/SKILL.md");
  });
});
