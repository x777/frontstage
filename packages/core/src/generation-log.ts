export interface GenerationLogEntry {
  id: string;
  model: string;
  costCredits: number | null;
  createdAt: string | null; // ISO 8601
}

export interface GenerationLog {
  version: number;
  entries: GenerationLogEntry[];
}

export function emptyGenerationLog(): GenerationLog {
  return { version: 1, entries: [] };
}
