// Pure(ish) fs helpers backing the skills:* IPC (M15 T2) — the desktop half of SkillStorage, over
// ~/.palmier/skills/<id>/SKILL.md (SHARED with the Swift app's SkillStore.swift layout). No
// `electron` import — every function takes skillsRoot/homeDir explicitly, so this loads under
// plain Node (vitest) the same way it loads via index.cjs's dynamic import() — mirrors
// project-registry.mjs's convention.

import fs from "node:fs";
import path from "node:path";

const SKILL_MD = "SKILL.md";
const LEDGER_FILENAME = ".installed.json";

export function skillsRootPath(homeDir) {
  return path.join(homeDir, ".palmier", "skills");
}

// Mirrors SkillStore.swift's isValidSkillId: a single safe path component, never empty/"."/"..".
export function isValidSkillId(id) {
  return typeof id === "string" && id !== "" && id !== "." && id !== ".." && !id.includes("/") && !id.includes("\\");
}

export function skillDirPath(skillsRoot, id) {
  if (!isValidSkillId(id)) throw new Error(`invalid skill id: ${id}`);
  return path.join(skillsRoot, id);
}

export function skillMdPath(skillsRoot, id) {
  return path.join(skillDirPath(skillsRoot, id), SKILL_MD);
}

// Tries every entry under skillsRoot (files included — a non-directory entry's SKILL.md read just
// fails and is skipped), same blanket try?-and-skip semantics as SkillStore.scan().
export function listSkills(skillsRoot) {
  let entries;
  try {
    entries = fs.readdirSync(skillsRoot);
  } catch {
    return [];
  }
  const result = [];
  for (const id of entries) {
    try {
      const text = fs.readFileSync(path.join(skillsRoot, id, SKILL_MD), "utf8");
      result.push({ id, text });
    } catch {
      continue; // no SKILL.md (or unreadable) — not a skill folder
    }
  }
  return result;
}

export function readSkill(skillsRoot, id) {
  try {
    return fs.readFileSync(skillMdPath(skillsRoot, id), "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

export function writeSkill(skillsRoot, id, text) {
  const dir = skillDirPath(skillsRoot, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, SKILL_MD), text, "utf8");
}

export function removeSkill(skillsRoot, id) {
  fs.rmSync(skillDirPath(skillsRoot, id), { recursive: true, force: true });
}

export function ledgerFilePath(skillsRoot) {
  return path.join(skillsRoot, LEDGER_FILENAME);
}

export function readLedgerFile(skillsRoot) {
  try {
    const parsed = JSON.parse(fs.readFileSync(ledgerFilePath(skillsRoot), "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function writeLedgerFile(skillsRoot, ledger) {
  fs.mkdirSync(skillsRoot, { recursive: true });
  fs.writeFileSync(ledgerFilePath(skillsRoot), JSON.stringify(ledger));
}

// External coding agents that read the same SKILL.md format from their own folders (mirrors
// Swift's SkillExternalAgent).
export const EXPORT_AGENTS = new Set(["claude", "codex", "cursor"]);

export function isAllowedExportAgent(agent) {
  return typeof agent === "string" && EXPORT_AGENTS.has(agent);
}

// ~/.<agent>/skills/palmier-<id>/ — the "palmier-" prefix so we only ever overwrite our own prior
// copy (Swift's SkillStore.copy).
export function exportDestDir(homeDir, agent, id) {
  return path.join(homeDir, `.${agent}`, "skills", `palmier-${id}`);
}

export function exportSkillToAgent(skillsRoot, homeDir, id, agent) {
  if (!isAllowedExportAgent(agent)) throw new Error(`invalid export agent: ${agent}`);
  const source = skillDirPath(skillsRoot, id);
  if (!fs.existsSync(source)) throw new Error(`skill not found: ${id}`);
  const dest = exportDestDir(homeDir, agent, id);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.rmSync(dest, { recursive: true, force: true }); // overwrite any prior copy, per Swift
  fs.cpSync(source, dest, { recursive: true });
  return dest;
}
