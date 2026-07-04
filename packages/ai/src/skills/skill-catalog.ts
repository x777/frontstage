// Host-agnostic port of Swift's @MainActor SkillCatalog — fetches the community skill catalog
// from the palmier-skills repo (raw GitHub CDN by default), cache-first.

export interface SkillCatalogEntry {
  id: string;
  name: string;
  description: string;
  sha: string;
  path: string;
}

export interface SkillCatalogDeps {
  fetchText(url: string): Promise<string>;
  cacheRead(): Promise<string | null>;
  cacheWrite(s: string): Promise<void>;
  baseUrl?: string;
}

const DEFAULT_BASE_URL = "https://raw.githubusercontent.com/palmier-io/palmier-skills/main";

export class SkillCatalog {
  private readonly deps: SkillCatalogDeps;
  private readonly baseUrl: string;
  private entries: SkillCatalogEntry[] = [];

  constructor(deps: SkillCatalogDeps) {
    this.deps = deps;
    this.baseUrl = deps.baseUrl ?? DEFAULT_BASE_URL;
  }

  // Reads the on-disk/localStorage cache written by a prior refresh(); malformed cache is
  // swallowed (Swift's `try?` semantics) rather than thrown.
  async loadCached(): Promise<SkillCatalogEntry[]> {
    const cached = await this.deps.cacheRead();
    if (cached !== null) {
      try {
        this.entries = JSON.parse(cached) as SkillCatalogEntry[];
      } catch {
        // malformed cache — leave entries as-is, same as Swift's silent failure
      }
    }
    return this.entries;
  }

  async refresh(): Promise<SkillCatalogEntry[]> {
    const text = await this.deps.fetchText(`${this.baseUrl}/catalog.json`);
    this.entries = JSON.parse(text) as SkillCatalogEntry[];
    await this.deps.cacheWrite(text);
    return this.entries;
  }

  async skillText(entry: SkillCatalogEntry): Promise<string> {
    return this.deps.fetchText(`${this.baseUrl}/${entry.path}`);
  }
}
