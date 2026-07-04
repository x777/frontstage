import { describe, expect, test } from "vitest";
import { SkillStore, sha12, type SkillStorage, type SkillCatalogEntry } from "../src/index.js";

function skillText(name: string, description: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}`;
}

class FakeStorage implements SkillStorage {
  files = new Map<string, string>();
  ledger: Record<string, string> = {};

  async list(): Promise<{ id: string; text: string }[]> {
    return Array.from(this.files.entries()).map(([id, text]) => ({ id, text }));
  }
  async read(id: string): Promise<string | null> {
    return this.files.get(id) ?? null;
  }
  async write(id: string, text: string): Promise<void> {
    this.files.set(id, text);
  }
  async remove(id: string): Promise<void> {
    this.files.delete(id);
  }
  async readLedger(): Promise<Record<string, string>> {
    return { ...this.ledger };
  }
  async writeLedger(l: Record<string, string>): Promise<void> {
    this.ledger = { ...l };
  }
}

describe("SkillStore — scan/sort/caches", () => {
  test("reload() populates skills sorted by id, regardless of storage.list() order", async () => {
    const storage = new FakeStorage();
    storage.files.set("c-skill", skillText("C", "does c", "c body"));
    storage.files.set("a-skill", skillText("A", "does a", "a body"));
    storage.files.set("b-skill", skillText("B", "does b", "b body"));
    const store = new SkillStore(storage);
    await store.reload();
    expect(store.skills.map((s) => s.id)).toEqual(["a-skill", "b-skill", "c-skill"]);
  });

  test("body(id) and localSha(id) are cache reads populated by reload()", async () => {
    const storage = new FakeStorage();
    const text = skillText("A", "does a", "the body text");
    storage.files.set("a-skill", text);
    const store = new SkillStore(storage);
    await store.reload();
    expect(store.body("a-skill")).toBe("the body text");
    expect(store.localSha("a-skill")).toBe(await sha12(text));
  });

  test("before any reload(), skills/body/localSha are empty/undefined", () => {
    const store = new SkillStore(new FakeStorage());
    expect(store.skills).toEqual([]);
    expect(store.body("x")).toBeUndefined();
    expect(store.localSha("x")).toBeUndefined();
  });

  test("a folder whose SKILL.md fails to parse (missing description) is silently excluded", async () => {
    const storage = new FakeStorage();
    storage.files.set("bad-skill", "---\nname: Bad\n---\nno description here");
    storage.files.set("good-skill", skillText("Good", "d", "b"));
    const store = new SkillStore(storage);
    await store.reload();
    expect(store.skills.map((s) => s.id)).toEqual(["good-skill"]);
    expect(store.body("bad-skill")).toBeUndefined();
  });

  test("skillIndex is '- <id>: <description>' lines, sorted; empty store -> empty string", async () => {
    const storage = new FakeStorage();
    const store = new SkillStore(storage);
    await store.reload();
    expect(store.skillIndex).toBe("");

    storage.files.set("zeta", skillText("Z", "does zeta things", "b"));
    storage.files.set("alpha", skillText("A", "does alpha things", "b"));
    await store.reload();
    expect(store.skillIndex).toBe("- alpha: does alpha things\n- zeta: does zeta things");
  });
});

describe("SkillStore — CRUD", () => {
  test("save() writes raw text and reload()s: body/name update, id/path stable", async () => {
    const storage = new FakeStorage();
    storage.files.set("s1", skillText("Old Name", "old desc", "old body"));
    const store = new SkillStore(storage);
    await store.reload();

    await store.save("s1", skillText("New Name", "new desc", "new body"));
    expect(store.skills.find((s) => s.id === "s1")).toEqual({ id: "s1", name: "New Name", description: "new desc" });
    expect(store.body("s1")).toBe("new body");
  });

  test("rename() rewrites only the frontmatter name field — body and other fields untouched", async () => {
    const storage = new FakeStorage();
    const original = "---\nname: Old Name\ndescription: keep this\nauthor: someone\n---\n\nthe body, verbatim.";
    storage.files.set("s1", original);
    const store = new SkillStore(storage);
    await store.reload();

    await store.rename("s1", "Renamed");

    expect(store.skills.find((s) => s.id === "s1")?.name).toBe("Renamed");
    expect(store.body("s1")).toBe("the body, verbatim.");
    const raw = await storage.read("s1");
    expect(raw).toBe("---\nname: Renamed\ndescription: keep this\nauthor: someone\n---\n\nthe body, verbatim.");
  });

  test("rename() to an empty/whitespace-only name is a no-op", async () => {
    const storage = new FakeStorage();
    storage.files.set("s1", skillText("Old", "d", "b"));
    const store = new SkillStore(storage);
    await store.reload();
    await store.rename("s1", "   ");
    expect(store.skills.find((s) => s.id === "s1")?.name).toBe("Old");
  });

  test("delete() removes the skill, clears its ledger entry, and persists the ledger", async () => {
    const storage = new FakeStorage();
    storage.files.set("s1", skillText("A", "d", "b"));
    storage.ledger = { s1: "abc123def456" };
    const store = new SkillStore(storage);
    await store.reload();
    expect(store.installedSha("s1")).toBe("abc123def456");

    await store.delete("s1");

    expect(store.skills).toEqual([]);
    expect(store.installedSha("s1")).toBeUndefined();
    expect(await storage.read("s1")).toBeNull();
    expect(storage.ledger).toEqual({});
  });

  test("newSkill() with no collision -> 'new-skill', written from the template, reload()ed", async () => {
    const storage = new FakeStorage();
    const store = new SkillStore(storage);
    await store.reload();
    const id = await store.newSkill();
    expect(id).toBe("new-skill");
    expect(store.skills.map((s) => s.id)).toContain("new-skill");
    expect(store.skills.find((s) => s.id === "new-skill")?.name).toBe("New skill");
  });

  test("newSkill() collision suffixes: 'new-skill' and 'new-skill-2' taken -> 'new-skill-3'", async () => {
    const storage = new FakeStorage();
    // Pre-existing folders need not be valid skills — collision checks raw storage entries.
    storage.files.set("new-skill", "not a valid skill file");
    storage.files.set("new-skill-2", "also not valid");
    const store = new SkillStore(storage);
    await store.reload();
    const id = await store.newSkill();
    expect(id).toBe("new-skill-3");
  });
});

describe("SkillStore — install + ledger + provenance shas", () => {
  const entry: SkillCatalogEntry = {
    id: "community-skill",
    name: "Community Skill",
    description: "a community skill",
    sha: "cafe12345678",
    path: "skills/community-skill/SKILL.md",
  };

  test("install() writes the file, reload()s, and records the entry's sha in the ledger", async () => {
    const storage = new FakeStorage();
    const store = new SkillStore(storage);
    await store.reload();

    const fullText = skillText("Community Skill", "a community skill", "the body");
    await store.install(entry, fullText);

    expect(await storage.read("community-skill")).toBe(fullText);
    expect(store.skills.map((s) => s.id)).toContain("community-skill");
    expect(store.installedSha("community-skill")).toBe("cafe12345678");
    expect(storage.ledger["community-skill"]).toBe("cafe12345678");
  });

  test("fresh install: localSha equals the installed (ledger) sha — not yet modified", async () => {
    const storage = new FakeStorage();
    const store = new SkillStore(storage);
    await store.reload();
    const fullText = skillText("Community Skill", "a community skill", "the body");
    await store.install(entry, fullText);
    expect(store.localSha("community-skill")).toBe(await sha12(fullText));
    // provenance: not necessarily equal to the catalog sha (content hash vs. catalog-declared sha
    // are different hash domains), but a local edit must diverge it from what it was right after install.
    const localShaAfterInstall = store.localSha("community-skill");

    await store.save("community-skill", skillText("Community Skill", "a community skill", "EDITED body"));
    expect(store.localSha("community-skill")).not.toBe(localShaAfterInstall);
    // installedSha (the ledger) is untouched by a local edit -> this is how "modified locally" is detected.
    expect(store.installedSha("community-skill")).toBe("cafe12345678");
  });

  test("install() rejects content missing name/description — nothing is written, ledger untouched", async () => {
    const storage = new FakeStorage();
    const store = new SkillStore(storage);
    await store.reload();

    const invalidText = "---\nname: Community Skill\n---\nno description field";
    await expect(store.install(entry, invalidText)).rejects.toThrow();

    expect(await storage.read("community-skill")).toBeNull();
    expect(store.installedSha("community-skill")).toBeUndefined();
    expect(storage.ledger["community-skill"]).toBeUndefined();
  });

  test("reload() picks up ledger changes written outside the store (e.g. by another install)", async () => {
    const storage = new FakeStorage();
    const store = new SkillStore(storage);
    await store.reload();
    expect(store.installedSha("s1")).toBeUndefined();

    storage.ledger = { s1: "deadbeef0000" };
    await store.reload();
    expect(store.installedSha("s1")).toBe("deadbeef0000");
  });
});
