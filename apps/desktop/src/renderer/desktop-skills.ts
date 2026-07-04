import type { SkillStorage, SkillCatalogDeps } from "@palmier/ai";

interface DesktopSkillsBridge {
  list(): Promise<{ id: string; text: string }[]>;
  read(id: string): Promise<string | null>;
  write(id: string, text: string): Promise<void>;
  remove(id: string): Promise<void>;
  readLedger(): Promise<Record<string, string>>;
  writeLedger(l: Record<string, string>): Promise<void>;
  reveal(id: string): Promise<void>;
  openRoot(): Promise<void>;
  exportToAgent(id: string, agent: "claude" | "codex" | "cursor"): Promise<{ path: string }>;
  cacheRead(): Promise<string | null>;
  cacheWrite(s: string): Promise<void>;
}

declare global {
  interface Window {
    desktopSkills: DesktopSkillsBridge;
  }
}

// Desktop's SkillStorage (M15 T2) — a thin IPC facade over ~/.palmier/skills, id sanitization and
// export-allowlist enforcement all live main-side (skills-fs.mjs), not here.
export function createDesktopSkillStorage(): SkillStorage {
  return {
    list: () => window.desktopSkills.list(),
    read: (id) => window.desktopSkills.read(id),
    write: (id, text) => window.desktopSkills.write(id, text),
    remove: (id) => window.desktopSkills.remove(id),
    readLedger: () => window.desktopSkills.readLedger(),
    writeLedger: (l) => window.desktopSkills.writeLedger(l),
    revealSkill: (id) => window.desktopSkills.reveal(id),
    openRoot: () => window.desktopSkills.openRoot(),
    exportToAgent: (id, agent) => window.desktopSkills.exportToAgent(id, agent),
  };
}

// The community catalog's cache lives in a userData file (main-side); fetchText is a plain fetch
// against the raw GitHub CDN (SkillCatalog's default baseUrl).
export function createDesktopSkillCatalogDeps(): SkillCatalogDeps {
  return {
    fetchText: async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
      return res.text();
    },
    cacheRead: () => window.desktopSkills.cacheRead(),
    cacheWrite: (s) => window.desktopSkills.cacheWrite(s),
  };
}
