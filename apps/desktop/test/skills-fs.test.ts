import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  isValidSkillId,
  skillsRootPath,
  skillDirPath,
  skillMdPath,
  listSkills,
  readSkill,
  writeSkill,
  removeSkill,
  ledgerFilePath,
  readLedgerFile,
  writeLedgerFile,
  isAllowedExportAgent,
  exportDestDir,
  exportSkillToAgent,
} from "../src/main/skills-fs.mjs";

// skills-fs.mjs takes skillsRoot/homeDir explicitly (no `electron` import), so it loads under
// plain Node/vitest the same way index.cjs loads it via dynamic import() — mirrors
// project-registry.test.ts's convention for testing the electron-free logic directly.

let root: string;
let home: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "palmier-skills-"));
  home = fs.mkdtempSync(path.join(os.tmpdir(), "palmier-home-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

function writeSkillMd(dir: string, id: string, text: string) {
  const skillDir = path.join(dir, id);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), text, "utf8");
}

describe("skillsRootPath", () => {
  test("joins homeDir with .palmier/skills", () => {
    expect(skillsRootPath("/x")).toBe(path.join("/x", ".palmier", "skills"));
  });
});

describe("isValidSkillId — the path-traversal guard", () => {
  test("accepts a plain id", () => {
    expect(isValidSkillId("my-skill")).toBe(true);
  });

  test("rejects empty", () => {
    expect(isValidSkillId("")).toBe(false);
  });

  test("rejects '.' and '..'", () => {
    expect(isValidSkillId(".")).toBe(false);
    expect(isValidSkillId("..")).toBe(false);
  });

  test("rejects a forward slash (traversal attempt)", () => {
    expect(isValidSkillId("../../etc/passwd")).toBe(false);
    expect(isValidSkillId("a/b")).toBe(false);
  });

  test("rejects a backslash (Windows traversal attempt)", () => {
    expect(isValidSkillId("..\\..\\Windows")).toBe(false);
    expect(isValidSkillId("a\\b")).toBe(false);
  });

  test("rejects non-string values", () => {
    expect(isValidSkillId(undefined as unknown as string)).toBe(false);
    expect(isValidSkillId(null as unknown as string)).toBe(false);
    expect(isValidSkillId(42 as unknown as string)).toBe(false);
  });

  test("a name containing dots elsewhere is fine", () => {
    expect(isValidSkillId("v1.2-final")).toBe(true);
  });
});

describe("skillDirPath / skillMdPath", () => {
  test("builds the expected paths for a valid id", () => {
    expect(skillDirPath(root, "foo")).toBe(path.join(root, "foo"));
    expect(skillMdPath(root, "foo")).toBe(path.join(root, "foo", "SKILL.md"));
  });

  test("throws for every traversal attempt", () => {
    for (const bad of ["", ".", "..", "../x", "a/b", "a\\b"]) {
      expect(() => skillDirPath(root, bad)).toThrow(/invalid skill id/);
      expect(() => skillMdPath(root, bad)).toThrow(/invalid skill id/);
    }
  });
});

describe("listSkills", () => {
  test("missing root -> empty array", () => {
    expect(listSkills(path.join(root, "nonexistent"))).toEqual([]);
  });

  test("reads every folder with a SKILL.md, skips folders/files without one", () => {
    writeSkillMd(root, "alpha", "---\nname: Alpha\n---\nbody");
    writeSkillMd(root, "beta", "---\nname: Beta\n---\nbody2");
    fs.mkdirSync(path.join(root, "no-md"));
    fs.writeFileSync(path.join(root, ".installed.json"), "{}"); // a file entry, not a dir

    const entries = listSkills(root).sort((a, b) => a.id.localeCompare(b.id));
    expect(entries).toEqual([
      { id: "alpha", text: "---\nname: Alpha\n---\nbody" },
      { id: "beta", text: "---\nname: Beta\n---\nbody2" },
    ]);
  });
});

describe("readSkill / writeSkill / removeSkill round-trip", () => {
  test("write then read returns the same text", () => {
    writeSkill(root, "my-skill", "---\nname: X\ndescription: Y\n---\nbody");
    expect(readSkill(root, "my-skill")).toBe("---\nname: X\ndescription: Y\n---\nbody");
  });

  test("read of a nonexistent skill -> null", () => {
    expect(readSkill(root, "nope")).toBeNull();
  });

  test("remove deletes the whole folder; a subsequent read is null", () => {
    writeSkill(root, "my-skill", "content");
    removeSkill(root, "my-skill");
    expect(readSkill(root, "my-skill")).toBeNull();
    expect(fs.existsSync(path.join(root, "my-skill"))).toBe(false);
  });

  test("remove of a nonexistent skill is a no-op, not a throw", () => {
    expect(() => removeSkill(root, "nope")).not.toThrow();
  });

  test("write/read/remove all reject traversal ids", () => {
    expect(() => writeSkill(root, "../escape", "x")).toThrow(/invalid skill id/);
    expect(() => readSkill(root, "../escape")).toThrow(/invalid skill id/);
    expect(() => removeSkill(root, "../escape")).toThrow(/invalid skill id/);
  });
});

describe("ledger round-trip", () => {
  test("missing ledger file -> {}", () => {
    expect(readLedgerFile(root)).toEqual({});
  });

  test("write then read returns the same map", () => {
    writeLedgerFile(root, { alpha: "abc123456789" });
    expect(readLedgerFile(root)).toEqual({ alpha: "abc123456789" });
  });

  test("malformed JSON -> {}", () => {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(ledgerFilePath(root), "{ not json", "utf8");
    expect(readLedgerFile(root)).toEqual({});
  });

  test("non-object JSON (array) -> {}", () => {
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(ledgerFilePath(root), "[1,2,3]", "utf8");
    expect(readLedgerFile(root)).toEqual({});
  });

  test("writeLedgerFile creates the root dir if missing", () => {
    const freshRoot = path.join(root, "not-yet-created");
    writeLedgerFile(freshRoot, { a: "b" });
    expect(readLedgerFile(freshRoot)).toEqual({ a: "b" });
  });
});

describe("isAllowedExportAgent — the export allowlist", () => {
  test("accepts claude/codex/cursor", () => {
    expect(isAllowedExportAgent("claude")).toBe(true);
    expect(isAllowedExportAgent("codex")).toBe(true);
    expect(isAllowedExportAgent("cursor")).toBe(true);
  });

  test("rejects anything else, including case variants and non-strings", () => {
    expect(isAllowedExportAgent("Claude")).toBe(false);
    expect(isAllowedExportAgent("gemini")).toBe(false);
    expect(isAllowedExportAgent("")).toBe(false);
    expect(isAllowedExportAgent(undefined as unknown as string)).toBe(false);
    expect(isAllowedExportAgent(null as unknown as string)).toBe(false);
  });
});

describe("exportDestDir — the ~/.<agent>/skills/palmier-<id>/ prefix", () => {
  test("builds the expected path verbatim", () => {
    expect(exportDestDir("/home/u", "claude", "foo")).toBe(path.join("/home/u", ".claude", "skills", "palmier-foo"));
    expect(exportDestDir("/home/u", "codex", "bar")).toBe(path.join("/home/u", ".codex", "skills", "palmier-bar"));
    expect(exportDestDir("/home/u", "cursor", "baz")).toBe(path.join("/home/u", ".cursor", "skills", "palmier-baz"));
  });
});

describe("exportSkillToAgent", () => {
  test("copies the skill folder to the palmier-<id> prefixed dest and returns the path", () => {
    writeSkill(root, "my-skill", "---\nname: X\ndescription: Y\n---\nbody");
    const dest = exportSkillToAgent(root, home, "my-skill", "claude");
    expect(dest).toBe(exportDestDir(home, "claude", "my-skill"));
    expect(fs.readFileSync(path.join(dest, "SKILL.md"), "utf8")).toBe("---\nname: X\ndescription: Y\n---\nbody");
  });

  test("overwrites a prior copy at the same dest (per Swift's fileExists+removeItem)", () => {
    writeSkill(root, "my-skill", "v1");
    exportSkillToAgent(root, home, "my-skill", "claude");
    writeSkill(root, "my-skill", "v2");
    const dest = exportSkillToAgent(root, home, "my-skill", "claude");
    expect(fs.readFileSync(path.join(dest, "SKILL.md"), "utf8")).toBe("v2");
  });

  test("rejects an agent outside the allowlist, before touching the filesystem", () => {
    writeSkill(root, "my-skill", "content");
    expect(() => exportSkillToAgent(root, home, "my-skill", "gemini")).toThrow(/invalid export agent/);
    expect(fs.existsSync(path.join(home, ".gemini"))).toBe(false);
  });

  test("rejects a traversal id", () => {
    expect(() => exportSkillToAgent(root, home, "../escape", "claude")).toThrow(/invalid skill id/);
  });

  test("rejects a skill that doesn't exist", () => {
    expect(() => exportSkillToAgent(root, home, "nonexistent", "claude")).toThrow(/skill not found/);
  });

  test("copies with dereference:false explicitly pinned (non-dereferencing cp — see skills-fs.mjs comment)", () => {
    writeSkill(root, "my-skill", "content");
    const cpSpy = vi.spyOn(fs, "cpSync");
    exportSkillToAgent(root, home, "my-skill", "claude");
    expect(cpSpy).toHaveBeenCalledWith(
      path.join(root, "my-skill"),
      exportDestDir(home, "claude", "my-skill"),
      { recursive: true, dereference: false },
    );
    cpSpy.mockRestore();
  });
});

// M15 review finding (Medium): no regression coverage existed for a symlinked <id> skill folder.
// Real symlink creation needs elevated privilege on this Windows sandbox for a PLAIN symlink, but
// an NTFS junction needs none and is enough to prove the same thing: a directory-type reparse
// point that fs.rmSync (no recursion through it) must not dereference. exportSkillToAgent's cp
// step can't be exercised live the same way (see skills-fs.mjs comment) — that side is pinned
// above via a mock asserting the exact options object instead.
describe("removeSkill — symlinked <id> folder (non-dereferencing rm)", () => {
  test("unlinks the symlinked folder itself; the real target directory is untouched", (ctx) => {
    const targetDir = fs.mkdtempSync(path.join(os.tmpdir(), "palmier-symlink-target-"));
    fs.writeFileSync(path.join(targetDir, "marker.txt"), "must-survive");
    const linkPath = path.join(root, "linked-skill");
    try {
      fs.symlinkSync(targetDir, linkPath, "junction");
    } catch {
      // This environment can't create even a junction/symlink (e.g. a locked-down container) —
      // skip rather than fail; the safety property is still pinned by the mock-level test above.
      ctx.skip();
      return;
    }

    expect(fs.lstatSync(linkPath).isSymbolicLink()).toBe(true);
    removeSkill(root, "linked-skill");

    expect(fs.existsSync(linkPath)).toBe(false);
    expect(fs.existsSync(targetDir)).toBe(true);
    expect(fs.existsSync(path.join(targetDir, "marker.txt"))).toBe(true);
    fs.rmSync(targetDir, { recursive: true, force: true });
  });
});
