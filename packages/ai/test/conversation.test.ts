import { describe, expect, test } from "vitest";
import type { AgentMessage } from "../src/agent/conversation.js";
import { toWireMessages, toolResultToText } from "../src/agent/conversation.js";
import { DEFAULT_SYSTEM_PROMPT } from "../src/agent/system-prompt.js";

describe("toWireMessages — user message", () => {
  test("one text block → one wire user message with that content", () => {
    const msgs: AgentMessage[] = [
      { id: "m1", role: "user", content: [{ kind: "text", text: "hello" }] },
    ];
    const wire = toWireMessages(msgs);
    expect(wire).toHaveLength(1);
    expect(wire[0]).toEqual({ role: "user", content: "hello" });
  });
});

describe("toWireMessages — assistant message", () => {
  test("text + 2 toolCall blocks → one wire assistant message with content and tool_calls", () => {
    const msgs: AgentMessage[] = [
      {
        id: "m2",
        role: "assistant",
        content: [
          { kind: "text", text: "I'll do that." },
          { kind: "toolCall", id: "tc1", name: "addClips", argsJson: '{"trackId":"t1"}' },
          { kind: "toolCall", id: "tc2", name: "getTimeline", argsJson: '{}' },
        ],
      },
    ];
    const wire = toWireMessages(msgs);
    expect(wire).toHaveLength(1);
    const w0 = wire[0]!;
    expect(w0.role).toBe("assistant");
    expect(w0.content).toBe("I'll do that.");
    expect(w0.tool_calls).toHaveLength(2);
    expect(w0.tool_calls![0]).toEqual({ id: "tc1", type: "function", function: { name: "addClips", arguments: '{"trackId":"t1"}' } });
    expect(w0.tool_calls![1]).toEqual({ id: "tc2", type: "function", function: { name: "getTimeline", arguments: '{}' } });
  });

  test("only toolCall blocks (no text) → content === null", () => {
    const msgs: AgentMessage[] = [
      {
        id: "m3",
        role: "assistant",
        content: [
          { kind: "toolCall", id: "tc3", name: "removeClips", argsJson: '{"ids":["c1"]}' },
        ],
      },
    ];
    const wire = toWireMessages(msgs);
    expect(wire).toHaveLength(1);
    const w0 = wire[0]!;
    expect(w0.role).toBe("assistant");
    expect(w0.content).toStrictEqual(null);
    expect(w0.tool_calls).toHaveLength(1);
  });
});

describe("toWireMessages — tool message", () => {
  test("2 toolResult blocks → TWO wire tool messages with matching tool_call_ids", () => {
    const msgs: AgentMessage[] = [
      {
        id: "m4",
        role: "tool",
        content: [
          { kind: "toolResult", toolCallId: "tc1", blocks: [{ kind: "text", text: "done" }], isError: false },
          { kind: "toolResult", toolCallId: "tc2", blocks: [{ kind: "text", text: "error" }], isError: true },
        ],
      },
    ];
    const wire = toWireMessages(msgs);
    expect(wire).toHaveLength(2);
    expect(wire[0]).toEqual({ role: "tool", tool_call_id: "tc1", content: "done" });
    expect(wire[1]).toEqual({ role: "tool", tool_call_id: "tc2", content: "error" });
  });
});

describe("toolResultToText", () => {
  test("text blocks joined, image blocks become [image]", () => {
    const result = toolResultToText([
      { kind: "text", text: "a" },
      { kind: "image", base64: "abc123", mediaType: "image/png" },
      { kind: "text", text: "b" },
    ]);
    expect(result).toContain("a");
    expect(result).toContain("[image]");
    expect(result).toContain("b");
  });

  test("empty array → empty string", () => {
    expect(toolResultToText([])).toBe("");
  });
});

describe("DEFAULT_SYSTEM_PROMPT", () => {
  test("is a non-empty string mentioning tools and editing", () => {
    expect(typeof DEFAULT_SYSTEM_PROMPT).toBe("string");
    expect(DEFAULT_SYSTEM_PROMPT.length).toBeGreaterThan(0);
    const lower = DEFAULT_SYSTEM_PROMPT.toLowerCase();
    expect(lower).toMatch(/tool|edit/);
  });
});
