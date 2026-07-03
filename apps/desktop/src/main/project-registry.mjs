// Pure(ish) helpers backing the MCP project-nav tools' desktop registry (M13B T1, #238 ADAPTED).
// No `electron` import — every function takes a userDataDir explicitly, so this loads under plain
// Node (vitest) the same way it loads via index.cjs's dynamic import(). Mirrors the M12B convention
// of extracting only the electron-free logic into a directly-testable module (see
// apps/desktop/src/renderer/desktop-interop-export.ts + its test).

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const REGISTRY_FILENAME = "recent-projects.json";
export const DEFAULT_PROJECT_NAME = "Untitled Project";

function isValidEntry(e) {
  return (
    !!e &&
    typeof e.id === "string" &&
    typeof e.name === "string" &&
    typeof e.path === "string" &&
    typeof e.lastOpenedAt === "string"
  );
}

export function registryFilePath(userDataDir) {
  return path.join(userDataDir, REGISTRY_FILENAME);
}

export function loadRegistry(userDataDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(registryFilePath(userDataDir), "utf8"));
    return Array.isArray(parsed) ? parsed.filter(isValidEntry) : [];
  } catch {
    return [];
  }
}

export function saveRegistryEntries(userDataDir, entries) {
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(registryFilePath(userDataDir), JSON.stringify(entries));
}

// Most-recently-opened first — get_projects' ordering contract.
export function registryList(userDataDir) {
  return loadRegistry(userDataDir)
    .slice()
    .sort((a, b) => (a.lastOpenedAt < b.lastOpenedAt ? 1 : a.lastOpenedAt > b.lastOpenedAt ? -1 : 0));
}

export function registryResolve(userDataDir, id) {
  return loadRegistry(userDataDir).find((e) => e.id === id) ?? null;
}

// Upserts by resolved absolute path: a re-opened project keeps its id, refreshes name/lastOpenedAt.
export function registryUpsert(userDataDir, projectPath, name) {
  const resolved = path.resolve(projectPath);
  const entries = loadRegistry(userDataDir);
  const now = new Date().toISOString();
  const idx = entries.findIndex((e) => path.resolve(e.path) === resolved);
  let entry;
  if (idx >= 0) {
    entry = { ...entries[idx], name, path: resolved, lastOpenedAt: now };
    entries[idx] = entry;
  } else {
    entry = { id: crypto.randomUUID(), name, path: resolved, lastOpenedAt: now };
    entries.push(entry);
  }
  saveRegistryEntries(userDataDir, entries);
  return entry;
}

const NAME_INVALID_CHARS = /[\\/]/;

// Swift AppState.createProject's name check (ProjectError.invalidName): a plain single-component
// name, no separators or path components. Empty/whitespace-only defaults rather than rejecting.
export function validateProjectName(rawName) {
  const trimmed = (rawName ?? "").trim();
  const name = trimmed === "" ? DEFAULT_PROJECT_NAME : trimmed;
  if (NAME_INVALID_CHARS.test(name) || name === "." || name === "..") {
    return { ok: false, name };
  }
  return { ok: true, name };
}
