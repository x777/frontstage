/** Logical key/value store for one project's text files (project.json, media.json, …). */
export interface ProjectStore {
  readText(name: string): Promise<string | null>;
  writeText(name: string, data: string): Promise<void>;
}
