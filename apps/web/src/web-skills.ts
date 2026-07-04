import type { SkillStorage, SkillCatalogDeps } from "@palmier/ai";

// Web's SkillStorage (M15 T2) — the same facade as desktop's fs IPC, over OPFS:
// palmier-skills/<id>/SKILL.md + palmier-skills/.installed.json. No reveal/export members (no
// filesystem to reveal, no other agents' skill dirs to write into from a browser sandbox).

const SKILLS_DIR_NAME = "palmier-skills";
const SKILL_MD = "SKILL.md";
const LEDGER_FILENAME = ".installed.json";
const CATALOG_CACHE_KEY = "palmier.skills.catalogCache";

// Mirrors the desktop main-side guard (skills-fs.mjs's isValidSkillId) — defense in depth even
// though the File System Access API spec already rejects "."/".."/separators in handle names.
export function isValidSkillId(id: string): boolean {
  return typeof id === "string" && id !== "" && id !== "." && id !== ".." && !id.includes("/") && !id.includes("\\");
}

function requireValidId(id: string): void {
  if (!isValidSkillId(id)) throw new Error(`invalid skill id: ${id}`);
}

function isNotFound(e: unknown): boolean {
  return (e as DOMException)?.name === "NotFoundError";
}

export interface WebSkillStorageDeps {
  // Defaults to navigator.storage.getDirectory() (OPFS); overridable so tests can inject an
  // in-memory FileSystemDirectoryHandle-like shim (jsdom has no OPFS).
  getRoot?: () => Promise<FileSystemDirectoryHandle>;
}

export function createWebSkillStorage(deps: WebSkillStorageDeps = {}): SkillStorage {
  const getRoot = deps.getRoot ?? (() => navigator.storage.getDirectory());

  async function skillsDir(): Promise<FileSystemDirectoryHandle> {
    const root = await getRoot();
    return root.getDirectoryHandle(SKILLS_DIR_NAME, { create: true });
  }

  async function list(): Promise<{ id: string; text: string }[]> {
    const dir = await skillsDir();
    const result: { id: string; text: string }[] = [];
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== "directory") continue; // e.g. the ledger file sits alongside
      try {
        const fh = await handle.getFileHandle(SKILL_MD);
        result.push({ id: name, text: await (await fh.getFile()).text() });
      } catch (e) {
        if (!isNotFound(e)) throw e;
      }
    }
    return result;
  }

  async function read(id: string): Promise<string | null> {
    requireValidId(id);
    const dir = await skillsDir();
    try {
      const sub = await dir.getDirectoryHandle(id);
      const fh = await sub.getFileHandle(SKILL_MD);
      return await (await fh.getFile()).text();
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }

  async function write(id: string, text: string): Promise<void> {
    requireValidId(id);
    const dir = await skillsDir();
    const sub = await dir.getDirectoryHandle(id, { create: true });
    const fh = await sub.getFileHandle(SKILL_MD, { create: true });
    const w = await fh.createWritable();
    await w.write(text);
    await w.close();
  }

  async function remove(id: string): Promise<void> {
    requireValidId(id);
    const dir = await skillsDir();
    try {
      await dir.removeEntry(id, { recursive: true });
    } catch (e) {
      if (!isNotFound(e)) throw e;
    }
  }

  async function readLedger(): Promise<Record<string, string>> {
    const dir = await skillsDir();
    try {
      const fh = await dir.getFileHandle(LEDGER_FILENAME);
      const parsed: unknown = JSON.parse(await (await fh.getFile()).text());
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
    } catch {
      return {}; // missing file or malformed JSON — same silent-empty semantics as desktop
    }
  }

  async function writeLedger(l: Record<string, string>): Promise<void> {
    const dir = await skillsDir();
    const fh = await dir.getFileHandle(LEDGER_FILENAME, { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify(l));
    await w.close();
  }

  return { list, read, write, remove, readLedger, writeLedger };
}

// The community catalog's cache lives in localStorage; fetchText is a plain fetch (the raw GitHub
// CDN serves CORS *, per SkillCatalog's default baseUrl).
export function createWebSkillCatalogDeps(): SkillCatalogDeps {
  return {
    fetchText: async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
      return res.text();
    },
    cacheRead: async () => localStorage.getItem(CATALOG_CACHE_KEY),
    cacheWrite: async (s) => {
      localStorage.setItem(CATALOG_CACHE_KEY, s);
    },
  };
}
