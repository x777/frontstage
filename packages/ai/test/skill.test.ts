import { describe, expect, test } from "vitest";
import { parseSkillFile, replaceFrontmatterName, NEW_SKILL_TEMPLATE, sha12, skillsSection } from "../src/index.js";

describe("parseSkillFile — the frontmatter matrix", () => {
  test("valid frontmatter -> skill + trimmed body", () => {
    const text = "---\nname: My Skill\ndescription: Does a thing.\n---\n\nBody line one.\nBody line two.\n";
    const result = parseSkillFile("my-skill", text);
    expect(result).toEqual({
      skill: { id: "my-skill", name: "My Skill", description: "Does a thing." },
      body: "Body line one.\nBody line two.",
    });
  });

  test("quoted values are unquoted", () => {
    const text = '---\nname: "Quoted Name"\ndescription: "Quoted description."\n---\nbody';
    const result = parseSkillFile("q", text);
    expect(result?.skill.name).toBe("Quoted Name");
    expect(result?.skill.description).toBe("Quoted description.");
  });

  test("a lone quote character is not stripped (count >= 2 guard)", () => {
    const text = '---\nname: "\ndescription: d\n---\nbody';
    const result = parseSkillFile("q2", text);
    // value is exactly `"` (length 1) -> hasPrefix/hasSuffix both true on a single char in Swift,
    // but the `value.count >= 2` guard blocks stripping -> the literal quote survives.
    expect(result?.skill.name).toBe('"');
  });

  test("missing name -> rejected (null), not defaulted", () => {
    const text = "---\ndescription: only description\n---\nbody";
    expect(parseSkillFile("x", text)).toBeNull();
  });

  test("missing description -> rejected (null), not defaulted", () => {
    const text = "---\nname: only name\n---\nbody";
    expect(parseSkillFile("x", text)).toBeNull();
  });

  test("empty-string values still count as present (not rejected)", () => {
    const text = "---\nname:\ndescription:\n---\nbody";
    const result = parseSkillFile("empty-fields", text);
    expect(result).toEqual({ skill: { id: "empty-fields", name: "", description: "" }, body: "body" });
  });

  test("unknown/extra frontmatter keys are parsed but ignored downstream", () => {
    const text = "---\nname: N\ndescription: D\nauthor: someone\nversion: 3\n---\nbody";
    const result = parseSkillFile("extra", text);
    expect(result?.skill).toEqual({ id: "extra", name: "N", description: "D" });
  });

  test("no leading '---' line -> no frontmatter at all -> rejected", () => {
    const text = "name: N\ndescription: D\n\nbody text";
    expect(parseSkillFile("no-fm", text)).toBeNull();
  });

  test("unterminated frontmatter (no closing '---') -> body is empty, whatever fields were found still gate", () => {
    const text = "---\nname: N\ndescription: D\nno closing marker here";
    const result = parseSkillFile("unterminated", text);
    expect(result).toEqual({ skill: { id: "unterminated", name: "N", description: "D" }, body: "" });
  });

  test("empty frontmatter block ('---' immediately followed by '---') -> both fields missing -> rejected", () => {
    const text = "---\n---\nbody";
    expect(parseSkillFile("empty-block", text)).toBeNull();
  });

  test("body preservation: internal blank lines and indentation survive verbatim; only the outer edges trim", () => {
    const text =
      "---\nname: N\ndescription: D\n---\n\nfirst line\n\n  indented middle line\n\nlast line\n\n";
    const result = parseSkillFile("body-preserve", text);
    // Leading/trailing blank lines are trimmed away, but the blank line BETWEEN body lines and
    // the two-space indent on the middle line (not at an edge) survive exactly.
    expect(result?.body).toBe("first line\n\n  indented middle line\n\nlast line");
  });

  test("CRLF (Windows-authored) frontmatter parses identically to LF for name/description — deliberate Windows-tolerance deviation from Swift (see file header comment)", () => {
    const lf = "---\nname: My Skill\ndescription: Does a thing.\n---\n\nBody line one.\nBody line two.\n";
    const crlf = lf.replace(/\n/g, "\r\n");
    const lfResult = parseSkillFile("crlf-lf", lf);
    const crlfResult = parseSkillFile("crlf-crlf", crlf);
    expect(crlfResult?.skill.name).toBe("My Skill");
    expect(crlfResult?.skill.description).toBe("Does a thing.");
    expect(crlfResult?.skill.name).toBe(lfResult?.skill.name);
    expect(crlfResult?.skill.description).toBe(lfResult?.skill.description);
    // Cosmetic: the raw CRLF body retains embedded \r before each internal \n (only the outer
    // edges are trimmed) — stripping it matches the LF body exactly.
    expect(crlfResult?.body.replace(/\r/g, "")).toBe(lfResult?.body);
  });

  test("NEW_SKILL_TEMPLATE itself parses successfully and round-trips", () => {
    const result = parseSkillFile("new-skill", NEW_SKILL_TEMPLATE);
    expect(result).toEqual({
      skill: {
        id: "new-skill",
        name: "New skill",
        description: "Describe in one line when the assistant should use this skill.",
      },
      body: "## Workflow\n1. First step.\n2. Second step.",
    });
  });
});

describe("replaceFrontmatterName", () => {
  test("replaces only the name field; other fields and body untouched", () => {
    const text = "---\nname: Old\ndescription: D\nauthor: someone\n---\n\nBody untouched.";
    const updated = replaceFrontmatterName(text, "New Name");
    expect(updated).toBe("---\nname: New Name\ndescription: D\nauthor: someone\n---\n\nBody untouched.");
  });

  test("no existing name field -> one is inserted at the top of the frontmatter", () => {
    const text = "---\ndescription: D\n---\nbody";
    const updated = replaceFrontmatterName(text, "New Name");
    expect(updated).toBe("---\nname: New Name\ndescription: D\n---\nbody");
  });

  test("no frontmatter at all -> one is prepended", () => {
    const text = "just some text, no frontmatter";
    const updated = replaceFrontmatterName(text, "New Name");
    expect(updated).toBe("---\nname: New Name\n---\n\njust some text, no frontmatter");
  });
});

describe("sha12", () => {
  test("known vector: empty string", async () => {
    expect(await sha12("")).toBe("e3b0c44298fc");
  });

  test("known vector: 'hello'", async () => {
    expect(await sha12("hello")).toBe("2cf24dba5fb0");
  });

  test("always 12 lowercase hex characters", async () => {
    const hash = await sha12("some skill file contents");
    expect(hash).toMatch(/^[0-9a-f]{12}$/);
  });

  test("different inputs produce different hashes", async () => {
    expect(await sha12("a")).not.toBe(await sha12("b"));
  });
});

describe("skillsSection — the digest (verbatim format)", () => {
  test("empty index -> empty string", () => {
    expect(skillsSection("")).toBe("");
  });

  test("non-empty index -> the verbatim header + steering + index", () => {
    const index = "- foo: does foo\n- bar: does bar";
    const result = skillsSection(index);
    expect(result).toBe(
      "\n# Skills\nPlaybooks for specific tasks. Before a task that matches one, call read_skill(id) to load its full procedure, then follow it.\n" +
        index,
    );
  });
});
