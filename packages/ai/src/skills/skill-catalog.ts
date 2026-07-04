// Host-agnostic port of Swift's @MainActor SkillCatalog — fetches the community skill catalog
// from the palmier-skills repo (raw GitHub CDN by default), cache-first.

import { z } from "zod";

export interface SkillCatalogEntry {
  id: string;
  name: string;
  description: string;
  sha: string;
  path: string;
}

// Runtime shape guard for the catalog payload — Swift's JSONDecoder throws on any shape mismatch
// (wrong top-level type, a non-string field, a missing key), leaving `entries` untouched. JSON.parse
// alone can't provide that: valid-JSON-but-wrong-shape would otherwise sail through as `entries`.
// All-or-nothing like JSONDecoder: one malformed entry rejects the whole payload, none are dropped.
const skillCatalogEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  sha: z.string(),
  path: z.string(),
});
const skillCatalogSchema = z.array(skillCatalogEntrySchema);

function parseCatalogPayload(text: string): SkillCatalogEntry[] {
  return skillCatalogSchema.parse(JSON.parse(text));
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
        this.entries = parseCatalogPayload(cached);
      } catch {
        // malformed or shape-invalid cache — leave entries as-is, same as Swift's silent failure
      }
    }
    return this.entries;
  }

  async refresh(): Promise<SkillCatalogEntry[]> {
    const text = await this.deps.fetchText(`${this.baseUrl}/catalog.json`);
    // Validate before assigning: a shape-invalid response must leave `this.entries` (and the
    // cache) untouched and throw, so the caller's catch (SkillsPane's catalogError) is the only
    // path a bad payload can take — mirrors Swift's decode-throws-before-assignment order.
    const parsed = parseCatalogPayload(text);
    this.entries = parsed;
    await this.deps.cacheWrite(text);
    return this.entries;
  }

  async skillText(entry: SkillCatalogEntry): Promise<string> {
    return this.deps.fetchText(`${this.baseUrl}/${entry.path}`);
  }
}
