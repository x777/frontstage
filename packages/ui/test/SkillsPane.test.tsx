import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SkillStore, SkillCatalog, sha12 } from "@palmier/ai";
import type { SkillStorage, SkillCatalogDeps, SkillCatalogEntry } from "@palmier/ai";
import { SkillsPane } from "../src/skills/SkillsPane.js";

function skillText(name: string, description: string, body: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}`;
}

class FakeStorage implements SkillStorage {
  files = new Map<string, string>();
  ledger: Record<string, string> = {};
  revealSkill?: (id: string) => Promise<void>;
  openRoot?: () => Promise<void>;
  exportToAgent?: (id: string, agent: "claude" | "codex" | "cursor") => Promise<{ path: string }>;

  async list() { return Array.from(this.files.entries()).map(([id, text]) => ({ id, text })); }
  async read(id: string) { return this.files.get(id) ?? null; }
  async write(id: string, text: string) { this.files.set(id, text); }
  async remove(id: string) { this.files.delete(id); }
  async readLedger() { return { ...this.ledger }; }
  async writeLedger(l: Record<string, string>) { this.ledger = { ...l }; }
}

// Generic catalog fixture: not sha-consistent (fine for tests that don't assert badge states).
function makeCatalogDeps(entries: SkillCatalogEntry[]): SkillCatalogDeps {
  let cache: string | null = null;
  return {
    fetchText: async (url: string) => {
      if (url.endsWith("catalog.json")) return JSON.stringify(entries);
      const entry = entries.find((e) => url.endsWith(e.path));
      if (!entry) throw new Error(`no fixture for ${url}`);
      return skillText(entry.name, entry.description, `${entry.id} body`);
    },
    cacheRead: async () => cache,
    cacheWrite: async (s: string) => { cache = s; },
  };
}

test("sections split by ledger provenance: no ledger entry -> My Skills, ledger entry -> Community", async () => {
  const storage = new FakeStorage();
  storage.files.set("my-skill", skillText("My Skill", "mine", "body"));
  storage.files.set("comm-skill", skillText("Comm Skill", "community", "body"));
  storage.ledger = { "comm-skill": "abc123def456" };
  const store = new SkillStore(storage);
  const catalog = new SkillCatalog(makeCatalogDeps([]));

  render(<SkillsPane store={store} catalog={catalog} />);

  await screen.findByTestId("skills-row-my-skill");
  await screen.findByTestId("skills-row-comm-skill");

  expect(screen.getByTestId("skills-section-my").textContent).toBe("MY SKILLS · 1");
  expect(screen.getByTestId("skills-section-community").textContent).toBe("COMMUNITY · 1");
  expect(screen.getByTestId("skills-provenance")).toBeTruthy(); // detail pane rendered for the first skill
});

test("search filters skills by name/description across both sections", async () => {
  const storage = new FakeStorage();
  storage.files.set("alpha", skillText("Alpha", "does alpha things", "b"));
  storage.files.set("beta", skillText("Beta", "does beta things", "b"));
  const store = new SkillStore(storage);
  const catalog = new SkillCatalog(makeCatalogDeps([]));
  render(<SkillsPane store={store} catalog={catalog} />);

  await screen.findByTestId("skills-row-alpha");
  await screen.findByTestId("skills-row-beta");

  fireEvent.change(screen.getByTestId("skills-search"), { target: { value: "alpha" } });

  expect(screen.getByTestId("skills-row-alpha")).toBeTruthy();
  expect(screen.queryByTestId("skills-row-beta")).toBeNull();
});

test("install flow: Install button -> catalog.skillText -> store.install -> row moves to the installed section", async () => {
  const storage = new FakeStorage();
  const store = new SkillStore(storage);
  const entry: SkillCatalogEntry = {
    id: "community-skill",
    name: "Community Skill",
    description: "a community skill",
    sha: "sha1sha1sha1",
    path: "skills/community-skill/SKILL.md",
  };
  const catalog = new SkillCatalog(makeCatalogDeps([entry]));

  render(<SkillsPane store={store} catalog={catalog} />);

  await screen.findByTestId("skills-available-community-skill");
  fireEvent.click(screen.getByTestId("skills-install-community-skill"));

  await waitFor(() => {
    expect(screen.queryByTestId("skills-available-community-skill")).toBeNull();
    expect(screen.getByTestId("skills-row-community-skill")).toBeTruthy();
  });
  expect(await storage.read("community-skill")).toContain("Community Skill");
  expect(store.installedSha("community-skill")).toBe("sha1sha1sha1");
});

test("update badge shows when the catalog sha diverges from the ledger; Update re-installs at the new sha", async () => {
  const storage = new FakeStorage();
  const oldBody = skillText("Comm Skill", "d", "old body");
  storage.files.set("comm-skill", oldBody);
  const oldSha = await sha12(oldBody);
  storage.ledger = { "comm-skill": oldSha };
  const store = new SkillStore(storage);

  const newBody = skillText("Comm Skill", "d", "new body");
  const newSha = await sha12(newBody);
  const entry: SkillCatalogEntry = { id: "comm-skill", name: "Comm Skill", description: "d", sha: newSha, path: "skills/comm-skill/SKILL.md" };
  const catalog = new SkillCatalog({
    fetchText: async (url: string) => (url.endsWith("catalog.json") ? JSON.stringify([entry]) : newBody),
    cacheRead: async () => null,
    cacheWrite: async () => {},
  });

  render(<SkillsPane store={store} catalog={catalog} />);
  await screen.findByTestId("skills-badge-update-comm-skill");

  fireEvent.click(screen.getByTestId("skills-row-comm-skill"));
  await screen.findByTestId("skills-update");
  fireEvent.click(screen.getByTestId("skills-update"));

  await waitFor(() => {
    expect(screen.queryByTestId("skills-badge-update-comm-skill")).toBeNull();
  });
  expect(store.installedSha("comm-skill")).toBe(newSha);
  expect(store.localSha("comm-skill")).toBe(newSha);
});

test("edit mode: changing the raw draft shows the dirty 'Edited' label; Save persists the raw text", async () => {
  const storage = new FakeStorage();
  const raw = skillText("My Skill", "d", "original body");
  storage.files.set("my-skill", raw);
  const store = new SkillStore(storage);
  const catalog = new SkillCatalog(makeCatalogDeps([]));

  render(<SkillsPane store={store} catalog={catalog} />);
  await screen.findByTestId("skills-row-my-skill");
  fireEvent.click(screen.getByTestId("skills-row-my-skill"));
  fireEvent.click(screen.getByTestId("skills-edit-toggle"));

  const editor = await screen.findByTestId("skills-editor");
  expect((editor as HTMLTextAreaElement).value).toBe(raw);
  expect(screen.queryByTestId("skills-edited")).toBeNull();

  const editedRaw = raw.replace("original body", "EDITED body");
  fireEvent.change(editor, { target: { value: editedRaw } });
  expect(screen.getByTestId("skills-edited")).toBeTruthy();

  fireEvent.click(screen.getByTestId("skills-save"));
  await waitFor(() => {
    expect(store.body("my-skill")).toBe("EDITED body");
  });
  expect(screen.queryByTestId("skills-edited")).toBeNull();
});

test("rename: double-clicking the title and committing renames the frontmatter name only", async () => {
  const storage = new FakeStorage();
  const original = "---\nname: Old Name\ndescription: keep\n---\n\nbody text";
  storage.files.set("s1", original);
  const store = new SkillStore(storage);
  const catalog = new SkillCatalog(makeCatalogDeps([]));

  render(<SkillsPane store={store} catalog={catalog} />);
  await screen.findByTestId("skills-row-s1");
  fireEvent.click(screen.getByTestId("skills-row-s1"));

  fireEvent.doubleClick(await screen.findByTestId("skills-title"));
  const input = screen.getByTestId("skills-rename-input");
  fireEvent.change(input, { target: { value: "New Name" } });
  fireEvent.keyDown(input, { key: "Enter" });

  await waitFor(() => {
    expect(screen.getByTestId("skills-title").textContent).toBe("New Name");
  });
  expect(await storage.read("s1")).toContain("body text");
  expect(await storage.read("s1")).toContain("name: New Name");
});

test("delete: window.confirm names the skill's path; confirming removes it", async () => {
  const storage = new FakeStorage();
  storage.files.set("my-skill", skillText("My Skill", "d", "b"));
  const store = new SkillStore(storage);
  const catalog = new SkillCatalog(makeCatalogDeps([]));

  const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<SkillsPane store={store} catalog={catalog} />);
  await screen.findByTestId("skills-row-my-skill");
  fireEvent.click(screen.getByTestId("skills-row-my-skill"));
  fireEvent.click(await screen.findByTestId("skills-delete"));

  expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("my-skill/SKILL.md"));
  await waitFor(() => {
    expect(screen.queryByTestId("skills-row-my-skill")).toBeNull();
  });
  confirmSpy.mockRestore();
});

test("delete: cancelling window.confirm leaves the skill in place", async () => {
  const storage = new FakeStorage();
  storage.files.set("my-skill", skillText("My Skill", "d", "b"));
  const store = new SkillStore(storage);
  const catalog = new SkillCatalog(makeCatalogDeps([]));

  const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<SkillsPane store={store} catalog={catalog} />);
  await screen.findByTestId("skills-row-my-skill");
  fireEvent.click(screen.getByTestId("skills-row-my-skill"));
  fireEvent.click(await screen.findByTestId("skills-delete"));

  expect(screen.getByTestId("skills-row-my-skill")).toBeTruthy();
  confirmSpy.mockRestore();
});

test("desktop-only affordances (open folder / reveal / add-to-agent) are hidden when the storage facade omits them (web-shaped store)", async () => {
  const storage = new FakeStorage(); // no revealSkill/openRoot/exportToAgent
  storage.files.set("my-skill", skillText("My Skill", "d", "b"));
  const store = new SkillStore(storage);
  const catalog = new SkillCatalog(makeCatalogDeps([]));

  render(<SkillsPane store={store} catalog={catalog} />);
  await screen.findByTestId("skills-row-my-skill");
  fireEvent.click(screen.getByTestId("skills-row-my-skill"));

  expect(screen.queryByTestId("skills-open-folder")).toBeNull();
  expect(screen.queryByTestId("skills-reveal")).toBeNull();
  expect(screen.queryByTestId("skills-copy-toggle")).toBeNull();
});

test("desktop-only affordances are present, and Add-to-agent shows the copied-path toast, when the facade implements them", async () => {
  const storage = new FakeStorage();
  storage.files.set("my-skill", skillText("My Skill", "d", "b"));
  storage.revealSkill = vi.fn().mockResolvedValue(undefined);
  storage.openRoot = vi.fn().mockResolvedValue(undefined);
  storage.exportToAgent = vi.fn().mockResolvedValue({ path: "/home/.claude/skills/palmier-my-skill" });
  const store = new SkillStore(storage);
  const catalog = new SkillCatalog(makeCatalogDeps([]));

  render(<SkillsPane store={store} catalog={catalog} />);
  await screen.findByTestId("skills-row-my-skill");
  expect(screen.getByTestId("skills-open-folder")).toBeTruthy();

  fireEvent.click(screen.getByTestId("skills-row-my-skill"));
  expect(await screen.findByTestId("skills-reveal")).toBeTruthy();
  expect(screen.getByTestId("skills-copy-toggle")).toBeTruthy();

  fireEvent.click(screen.getByTestId("skills-copy-toggle"));
  fireEvent.click(screen.getByTestId("skills-copy-claude"));

  await waitFor(() => {
    expect(screen.getByTestId("skills-copy-toast").textContent).toContain("Added to Claude");
  });
  expect(storage.exportToAgent).toHaveBeenCalledWith("my-skill", "claude");
});
