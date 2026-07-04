// Host-agnostic port of Swift's @MainActor SkillStore — the same scan/cache/CRUD/ledger behavior
// over an injected SkillStorage facade (desktop = fs IPC on ~/.palmier/skills, web = OPFS; T2).

import { NEW_SKILL_TEMPLATE, parseSkillFile, replaceFrontmatterName, sha12, type Skill } from "./skill.js";
import type { SkillCatalogEntry } from "./skill-catalog.js";

export interface SkillStorage {
  list(): Promise<{ id: string; text: string }[]>;
  read(id: string): Promise<string | null>;
  write(id: string, text: string): Promise<void>;
  remove(id: string): Promise<void>;
  readLedger(): Promise<Record<string, string>>;
  writeLedger(l: Record<string, string>): Promise<void>;
  revealSkill?(id: string): Promise<void>;
  openRoot?(): Promise<void>;
  exportToAgent?(id: string, agent: "claude" | "codex" | "cursor"): Promise<{ path: string }>;
}

export class SkillStore {
  private readonly storage: SkillStorage;
  private skillsList: Skill[] = [];
  private bodyCache = new Map<string, string>();
  private shaCache = new Map<string, string>();
  private ledger: Record<string, string> = {};

  constructor(storage: SkillStorage) {
    this.storage = storage;
  }

  // Rescans every skill folder, reparses each SKILL.md (invalid ones drop silently, same as
  // Swift's scan()), and refreshes the ledger from storage — there's no separate init step here,
  // so the first reload() doubles as one.
  async reload(): Promise<void> {
    const entries = await this.storage.list();
    const skills: Skill[] = [];
    const bodyCache = new Map<string, string>();
    const shaCache = new Map<string, string>();
    for (const { id, text } of entries) {
      const parsed = parseSkillFile(id, text);
      if (!parsed) continue;
      skills.push(parsed.skill);
      bodyCache.set(id, parsed.body);
      shaCache.set(id, await sha12(text));
    }
    skills.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    this.skillsList = skills;
    this.bodyCache = bodyCache;
    this.shaCache = shaCache;
    this.ledger = await this.storage.readLedger();
  }

  get skills(): Skill[] {
    return [...this.skillsList];
  }

  body(id: string): string | undefined {
    return this.bodyCache.get(id);
  }

  localSha(id: string): string | undefined {
    return this.shaCache.get(id);
  }

  installedSha(id: string): string | undefined {
    return this.ledger[id];
  }

  async save(id: string, fullText: string): Promise<void> {
    await this.storage.write(id, fullText);
    await this.reload();
  }

  // Rewrites only the frontmatter `name` field; the body and every other field are untouched.
  async rename(id: string, newName: string): Promise<void> {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const current = this.skillsList.find((s) => s.id === id);
    if (current && trimmed === current.name) return;
    const text = await this.storage.read(id);
    if (text === null) return;
    await this.storage.write(id, replaceFrontmatterName(text, trimmed));
    await this.reload();
  }

  async delete(id: string): Promise<void> {
    await this.storage.remove(id);
    delete this.ledger[id];
    await this.storage.writeLedger(this.ledger);
    await this.reload();
  }

  // "new-skill", suffixed "-2", "-3", ... on collision against any existing folder (parseable or
  // not — mirrors Swift's raw fileExists check, not the parsed skills list).
  async newSkill(): Promise<string> {
    const existing = new Set((await this.storage.list()).map((e) => e.id));
    let id = "new-skill";
    let n = 2;
    while (existing.has(id)) {
      id = `new-skill-${n}`;
      n++;
    }
    await this.storage.write(id, NEW_SKILL_TEMPLATE);
    await this.reload();
    return id;
  }

  // Validates before writing (stronger than Swift's write-then-rollback-on-failure) — a community
  // skill missing name/description is rejected outright, nothing touches storage or the ledger.
  async install(entry: SkillCatalogEntry, bodyText: string): Promise<void> {
    const parsed = parseSkillFile(entry.id, bodyText);
    if (!parsed) throw new Error(`install skill ${entry.id} rejected: missing name or description frontmatter`);
    await this.storage.write(entry.id, bodyText);
    await this.reload();
    this.ledger[entry.id] = entry.sha;
    await this.storage.writeLedger(this.ledger);
  }

  get skillIndex(): string {
    return this.skillsList.map((s) => `- ${s.id}: ${s.description}`).join("\n");
  }

  // Raw full-text (frontmatter + body) for the editor's raw-file edit mode — bypasses the
  // parsed/cached body since the editor writes the whole file back via save().
  async readRaw(id: string): Promise<string | undefined> {
    return (await this.storage.read(id)) ?? undefined;
  }

  // Capability flags + passthroughs for the desktop-only facade members (T3: the pane hides
  // these affordances entirely when the host's storage doesn't implement them, e.g. web/OPFS).
  get canReveal(): boolean {
    return this.storage.revealSkill !== undefined;
  }

  async revealSkill(id: string): Promise<void> {
    await this.storage.revealSkill?.(id);
  }

  get canOpenRoot(): boolean {
    return this.storage.openRoot !== undefined;
  }

  async openRoot(): Promise<void> {
    await this.storage.openRoot?.();
  }

  get canExportToAgent(): boolean {
    return this.storage.exportToAgent !== undefined;
  }

  async exportToAgent(id: string, agent: "claude" | "codex" | "cursor"): Promise<{ path: string } | undefined> {
    return this.storage.exportToAgent?.(id, agent);
  }
}
