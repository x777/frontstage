// Pure SKILL.md model + hand-rolled frontmatter parser — ported verbatim from Swift's
// SkillFrontmatter.parse / SkillStore.parseSkill (Agent/Skills/{Skill,SkillStore}.swift). No YAML
// dependency: only `name`/`description` are recognized; either missing rejects the whole file.

export interface Skill {
  id: string;
  name: string;
  description: string;
}

interface Frontmatter {
  fields: Record<string, string>;
  body: string;
}

// Mirrors SkillFrontmatter.parse: splits on a leading "---" line, `key: value` pairs (unknown
// keys kept but ignored downstream), quoted values unquoted, body = everything after the closing
// "---" trimmed. No closing "---" -> the rest of the file is consumed as frontmatter, body "".
function parseFrontmatter(text: string): Frontmatter {
  const fields: Record<string, string> = {};
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") {
    return { fields, body: text };
  }
  let i = 1;
  while (i < lines.length && lines[i]!.trim() !== "---") {
    const line = lines[i]!;
    const colon = line.indexOf(":");
    if (colon !== -1) {
      const key = line.slice(0, colon).trim();
      let value = line.slice(colon + 1).trim();
      if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      if (key !== "") fields[key] = value;
    }
    i++;
  }
  const body = i + 1 < lines.length ? lines.slice(i + 1).join("\n").trim() : "";
  return { fields, body };
}

// Mirrors SkillStore.parseSkill: name AND description must both be present (empty string counts
// as present) or the file is rejected outright — never defaulted.
export function parseSkillFile(id: string, text: string): { skill: Skill; body: string } | null {
  const { fields, body } = parseFrontmatter(text);
  const name = fields.name;
  const description = fields.description;
  if (name === undefined || description === undefined) return null;
  return { skill: { id, name, description }, body };
}

// Mirrors SkillFrontmatter.replacingName: rewrites only the `name` field, leaving every other
// frontmatter line and the body untouched. No frontmatter at all -> one is prepended.
export function replaceFrontmatterName(text: string, name: string): string {
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") {
    return `---\nname: ${name}\n---\n\n${text}`;
  }
  const front: string[] = [];
  let replaced = false;
  let i = 1;
  while (i < lines.length && lines[i]!.trim() !== "---") {
    const line = lines[i]!;
    const colon = line.indexOf(":");
    if (colon !== -1 && line.slice(0, colon).trim() === "name") {
      front.push(`name: ${name}`);
      replaced = true;
    } else {
      front.push(line);
    }
    i++;
  }
  if (!replaced) front.unshift(`name: ${name}`);
  const rest = i < lines.length ? lines.slice(i).join("\n") : "---";
  return `---\n${front.join("\n")}\n${rest}`;
}

// Verbatim from SkillStore.newSkill's template literal.
export const NEW_SKILL_TEMPLATE = `---
name: New skill
description: Describe in one line when the assistant should use this skill.
---

## Workflow
1. First step.
2. Second step.`;

// First 12 hex chars of SHA-256 — mirrors SkillStore's `sha12(_ data: Data)`. WebCrypto works
// unmodified in both hosts (browser + Node's global `crypto.subtle`) and in Vitest.
export async function sha12(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.slice(0, 12);
}
