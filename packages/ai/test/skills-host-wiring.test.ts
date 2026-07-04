import { describe, expect, test } from "vitest";
import { EditorStore, defaultTimeline, type MediaManifest } from "@palmier/core";
import {
  AgentSession,
  ToolExecutor,
  buildCatalog,
  SkillStore,
  skillsSection,
  type AiGateway,
  type ChatRequest,
  type StreamEvent,
  type ToolContext,
  type SkillStorage,
} from "../src/index.js";

// Models the exact host-wiring pattern T2 adds to apps/desktop/editor.tsx and apps/web/main.tsx:
// one SkillStore backs both an in-app AgentSession (getSkillsSuffix + ctx.skills) and an
// MCP-only ToolExecutor (neither) — proving the two paths diverge exactly as designed, using a
// real SkillStore over a mock in-memory SkillStorage (not a real fs/OPFS backend).

class FakeGateway implements AiGateway {
  readonly capturedSystems: string[] = [];
  constructor(private readonly events: StreamEvent[]) {}
  async *streamChat(req: ChatRequest): AsyncIterable<StreamEvent> {
    this.capturedSystems.push(req.system);
    for (const ev of this.events) yield ev;
  }
  async generateImage() {
    return { images: [] };
  }
}

function makeStorage(initial: { id: string; text: string }[]): SkillStorage {
  const skills = new Map(initial.map((s) => [s.id, s.text]));
  let ledger: Record<string, string> = {};
  return {
    list: async () => Array.from(skills, ([id, text]) => ({ id, text })),
    read: async (id) => skills.get(id) ?? null,
    write: async (id, text) => {
      skills.set(id, text);
    },
    remove: async (id) => {
      skills.delete(id);
    },
    readLedger: async () => ledger,
    writeLedger: async (l) => {
      ledger = l;
    },
  };
}

function makeManifest(): MediaManifest {
  return { version: 2, entries: [], folders: [] };
}

function baseCtx(): Pick<ToolContext, "store" | "getManifest" | "newId"> {
  return { store: new EditorStore(defaultTimeline()), getManifest: makeManifest, newId: () => "id" };
}

describe("skills host wiring (M15 T2)", () => {
  test("in-app: system instructions carry the digest after reload, and read_skill resolves via ctx.skills", async () => {
    const storage = makeStorage([{ id: "foo", text: "---\nname: Foo\ndescription: does foo\n---\nbody" }]);
    const store = new SkillStore(storage);

    const ctx: ToolContext = { ...baseCtx(), skills: { body: (id) => store.body(id) } };
    const executor = new ToolExecutor(buildCatalog(), ctx);
    const gateway = new FakeGateway([
      { type: "textDelta", text: "ok" },
      { type: "done", finishReason: "stop" },
    ]);
    const session = new AgentSession({
      gateway,
      executor,
      tools: buildCatalog(),
      model: "m",
      getSkillsSuffix: async () => {
        await store.reload();
        return skillsSection(store.skillIndex);
      },
    });

    await session.send("hi");

    expect(gateway.capturedSystems).toHaveLength(1);
    expect(gateway.capturedSystems[0]).toContain("# Skills");
    expect(gateway.capturedSystems[0]).toContain("- foo: does foo");

    const result = await executor.execute("read_skill", { id: "foo" });
    expect(result.isError).toBe(false);
    expect(result.blocks[0]).toEqual({ kind: "text", text: "body" });
  });

  test("mcp: no ctx.skills, no read_skill tool — the same store never leaks into it", async () => {
    const storage = makeStorage([{ id: "foo", text: "---\nname: Foo\ndescription: does foo\n---\nbody" }]);
    const store = new SkillStore(storage);
    await store.reload();

    // Built exactly like editor.tsx's mcpExecutor context: spread of the SAME base fields, but
    // never given a `skills` key.
    const mcpCtx: ToolContext = { ...baseCtx() };
    expect("skills" in mcpCtx).toBe(false);

    const mcpTools = buildCatalog("mcp");
    expect(mcpTools.some((t) => t.name === "read_skill")).toBe(false);

    const mcpExecutor = new ToolExecutor(mcpTools, mcpCtx);
    const result = await mcpExecutor.execute("read_skill", { id: "foo" });
    expect(result.isError).toBe(true);
    expect(result.blocks[0]).toEqual({ kind: "text", text: "unknown tool: read_skill" });

    // The MCP path has no AgentSession/system-prompt seam at all (T1's design: it calls tools
    // directly) — there's no "digest" to assert against, which is itself the point.
  });
});
