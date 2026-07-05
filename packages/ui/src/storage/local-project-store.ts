import type { ProjectStore } from "@frontstage/core";

/** ProjectStore backed by localStorage, keyed `namespace:name`. Falls back to an in-memory Map when localStorage is unavailable. */
export function localProjectStore(namespace: string): ProjectStore {
  // Fallback: created once per call; survives the host's lifetime but not page reloads.
  const fallback = new Map<string, string>();

  function key(name: string): string {
    return `${namespace}:${name}`;
  }

  return {
    async readText(name: string): Promise<string | null> {
      try {
        const val = localStorage.getItem(key(name));
        return val;
      } catch {
        return fallback.get(key(name)) ?? null;
      }
    },
    async writeText(name: string, data: string): Promise<void> {
      try {
        localStorage.setItem(key(name), data);
      } catch {
        fallback.set(key(name), data);
      }
    },
  };
}
