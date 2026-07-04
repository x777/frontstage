import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebSkillStorage, createWebSkillCatalogDeps, isValidSkillId } from "../src/web-skills.js";

// jsdom/OPFS aren't available under vitest's node environment (this repo runs web tests under
// plain node — see web-audio-extract.test.ts), so SkillStorage.list/read/write/remove/ledger are
// exercised against an in-memory FileSystemDirectoryHandle-like shim rather than the real OPFS.

function notFound(): DOMException {
  return new DOMException("not found", "NotFoundError");
}

class FakeFileHandle {
  readonly kind = "file" as const;
  content = "";
  constructor(public name: string) {}
  async getFile() {
    const content = this.content;
    return { text: async () => content };
  }
  async createWritable() {
    let buf = "";
    const self = this;
    return {
      write: async (data: string) => {
        buf += data;
      },
      close: async () => {
        self.content = buf;
      },
    };
  }
}

class FakeDirHandle {
  readonly kind = "directory" as const;
  children = new Map<string, FakeFileHandle | FakeDirHandle>();
  constructor(public name: string) {}

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FakeDirHandle> {
    let child = this.children.get(name);
    if (!child) {
      if (!options?.create) throw notFound();
      child = new FakeDirHandle(name);
      this.children.set(name, child);
    }
    if (!(child instanceof FakeDirHandle)) throw new Error(`not a directory: ${name}`);
    return child;
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FakeFileHandle> {
    let child = this.children.get(name);
    if (!child) {
      if (!options?.create) throw notFound();
      child = new FakeFileHandle(name);
      this.children.set(name, child);
    }
    if (!(child instanceof FakeFileHandle)) throw new Error(`not a file: ${name}`);
    return child;
  }

  async removeEntry(name: string, _options?: { recursive?: boolean }): Promise<void> {
    if (!this.children.has(name)) throw notFound();
    this.children.delete(name);
  }

  async *entries(): AsyncIterableIterator<[string, FakeFileHandle | FakeDirHandle]> {
    for (const entry of this.children) yield entry;
  }
}

function makeShim() {
  const root = new FakeDirHandle("");
  return { root, getRoot: async () => root as unknown as FileSystemDirectoryHandle };
}

describe("createWebSkillStorage — OPFS shim round-trip", () => {
  it("write then read returns the same text", async () => {
    const { getRoot } = makeShim();
    const storage = createWebSkillStorage({ getRoot });
    await storage.write("my-skill", "---\nname: X\ndescription: Y\n---\nbody");
    expect(await storage.read("my-skill")).toBe("---\nname: X\ndescription: Y\n---\nbody");
  });

  it("read of a nonexistent skill -> null", async () => {
    const { getRoot } = makeShim();
    const storage = createWebSkillStorage({ getRoot });
    expect(await storage.read("nope")).toBeNull();
  });

  it("list returns every written skill's {id, text}, ignores the ledger file", async () => {
    const { getRoot } = makeShim();
    const storage = createWebSkillStorage({ getRoot });
    await storage.write("alpha", "a-text");
    await storage.write("beta", "b-text");
    await storage.writeLedger({ alpha: "sha1" });

    const entries = (await storage.list()).sort((a, b) => a.id.localeCompare(b.id));
    expect(entries).toEqual([
      { id: "alpha", text: "a-text" },
      { id: "beta", text: "b-text" },
    ]);
  });

  it("list skips a directory entry with no SKILL.md", async () => {
    const { root, getRoot } = makeShim();
    const storage = createWebSkillStorage({ getRoot });
    await storage.write("real-skill", "content");
    const skillsDir = await root.getDirectoryHandle("palmier-skills", { create: true });
    await skillsDir.getDirectoryHandle("empty-dir", { create: true }); // no SKILL.md inside

    const entries = await storage.list();
    expect(entries).toEqual([{ id: "real-skill", text: "content" }]);
  });

  it("remove deletes the folder; a subsequent read is null", async () => {
    const { getRoot } = makeShim();
    const storage = createWebSkillStorage({ getRoot });
    await storage.write("my-skill", "content");
    await storage.remove("my-skill");
    expect(await storage.read("my-skill")).toBeNull();
    expect(await storage.list()).toEqual([]);
  });

  it("remove of a nonexistent skill is a no-op, not a throw", async () => {
    const { getRoot } = makeShim();
    const storage = createWebSkillStorage({ getRoot });
    await expect(storage.remove("nope")).resolves.toBeUndefined();
  });

  it("ledger round-trip: missing -> {}, write then read returns the same map", async () => {
    const { getRoot } = makeShim();
    const storage = createWebSkillStorage({ getRoot });
    expect(await storage.readLedger()).toEqual({});
    await storage.writeLedger({ alpha: "abc123456789" });
    expect(await storage.readLedger()).toEqual({ alpha: "abc123456789" });
  });

  it("malformed ledger JSON -> {}", async () => {
    const { root, getRoot } = makeShim();
    const skillsDir = await root.getDirectoryHandle("palmier-skills", { create: true });
    const ledgerHandle = await skillsDir.getFileHandle(".installed.json", { create: true });
    ledgerHandle.content = "{ not json";

    const storage = createWebSkillStorage({ getRoot });
    expect(await storage.readLedger()).toEqual({});
  });

  it("revealSkill/openRoot/exportToAgent are absent (web has no filesystem to reveal)", () => {
    const { getRoot } = makeShim();
    const storage = createWebSkillStorage({ getRoot });
    expect(storage.revealSkill).toBeUndefined();
    expect(storage.openRoot).toBeUndefined();
    expect(storage.exportToAgent).toBeUndefined();
  });

  describe("isValidSkillId — the path-traversal guard", () => {
    it("accepts a plain id", () => {
      expect(isValidSkillId("my-skill")).toBe(true);
    });

    it("rejects empty, '.', '..', and separators", () => {
      expect(isValidSkillId("")).toBe(false);
      expect(isValidSkillId(".")).toBe(false);
      expect(isValidSkillId("..")).toBe(false);
      expect(isValidSkillId("a/b")).toBe(false);
      expect(isValidSkillId("a\\b")).toBe(false);
    });
  });

  it("write/read/remove reject invalid ids before touching the shim", async () => {
    const { getRoot } = makeShim();
    const storage = createWebSkillStorage({ getRoot });
    await expect(storage.write("../escape", "x")).rejects.toThrow(/invalid skill id/);
    await expect(storage.read("..")).rejects.toThrow(/invalid skill id/);
    await expect(storage.remove("")).rejects.toThrow(/invalid skill id/);
  });
});

describe("createWebSkillCatalogDeps", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubLocalStorage() {
    const map = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
      removeItem: (k: string) => {
        map.delete(k);
      },
      clear: () => map.clear(),
      key: () => null,
      get length() {
        return map.size;
      },
    });
  }

  it("cacheRead is null before any cacheWrite", async () => {
    stubLocalStorage();
    const deps = createWebSkillCatalogDeps();
    expect(await deps.cacheRead()).toBeNull();
  });

  it("cacheWrite then cacheRead round-trips through localStorage", async () => {
    stubLocalStorage();
    const deps = createWebSkillCatalogDeps();
    await deps.cacheWrite('[{"id":"foo"}]');
    expect(await deps.cacheRead()).toBe('[{"id":"foo"}]');
  });

  it("fetchText fetches the given url as text", async () => {
    vi.stubGlobal("fetch", async (url: string) => ({ ok: true, status: 200, text: async () => `body for ${url}` }));
    const deps = createWebSkillCatalogDeps();
    expect(await deps.fetchText("https://example.com/x")).toBe("body for https://example.com/x");
  });

  it("fetchText throws on a non-ok response", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 404, text: async () => "" }));
    const deps = createWebSkillCatalogDeps();
    await expect(deps.fetchText("https://example.com/missing")).rejects.toThrow(/404/);
  });
});
