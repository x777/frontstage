import { describe, expect, test } from "vitest";
import { buildCatalog } from "../src/index.js";
import { toolsToOpenAI, buildChatBody, parseOpenRouterStream } from "../src/agent/openrouter.js";
import type { ChatRequest, OpenAIMessage } from "../src/agent/wire.js";

// Helper: encode strings as Uint8Array chunks
function asChunks(strings: string[]): AsyncIterable<Uint8Array> {
  const enc = new TextEncoder();
  return {
    [Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
      let i = 0;
      return {
        next(): Promise<IteratorResult<Uint8Array>> {
          if (i < strings.length) return Promise.resolve({ done: false, value: enc.encode(strings[i++]) });
          return Promise.resolve({ done: true, value: undefined as unknown as Uint8Array });
        },
      };
    },
  };
}

// Collect all events from the stream
async function collect(input: AsyncIterable<Uint8Array>): Promise<import("../src/agent/wire.js").StreamEvent[]> {
  const events: import("../src/agent/wire.js").StreamEvent[] = [];
  for await (const ev of parseOpenRouterStream(input)) events.push(ev);
  return events;
}

function hasNoRefOrSchema(obj: unknown, path = ""): void {
  if (obj === null || typeof obj !== "object") return;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    expect(`${path}.${k}`).not.toMatch(/\.\$ref$/);
    expect(`${path}.${k}`).not.toMatch(/\.\$schema$/);
    if (k === "$ref") throw new Error(`Found $ref at ${path}.${k}`);
    if (k === "$schema") throw new Error(`Found $schema at ${path}.${k}`);
    hasNoRefOrSchema(v, `${path}.${k}`);
  }
}

describe("toolsToOpenAI", () => {
  test("returns 34 function entries for buildCatalog()", () => {
    const result = toolsToOpenAI(buildCatalog());
    expect(result).toHaveLength(34);
    for (const entry of result) {
      expect(entry.type).toBe("function");
      expect(typeof entry.function.name).toBe("string");
      expect(typeof entry.function.description).toBe("string");
      expect(entry.function.parameters).toBeDefined();
      expect(typeof entry.function.parameters).toBe("object");
    }
  });

  test("parameters has no $schema or $ref at any level", () => {
    const result = toolsToOpenAI(buildCatalog());
    for (const entry of result) {
      hasNoRefOrSchema(entry.function.parameters, entry.function.name);
    }
  });

  test("does not throw", () => {
    expect(() => toolsToOpenAI(buildCatalog())).not.toThrow();
  });
});

describe("buildChatBody", () => {
  const msgs: OpenAIMessage[] = [{ role: "user", content: "hello" }];
  const req: ChatRequest = { model: "x/y", system: "You are helpful.", tools: [], messages: msgs };

  test("first message is the system message", () => {
    const body = buildChatBody(req) as Record<string, unknown>;
    const messages = body.messages as OpenAIMessage[];
    expect(messages[0]).toEqual({ role: "system", content: "You are helpful." });
  });

  test("subsequent messages match input messages", () => {
    const body = buildChatBody(req) as Record<string, unknown>;
    const messages = body.messages as OpenAIMessage[];
    expect(messages[1]).toEqual({ role: "user", content: "hello" });
  });

  test("stream is true", () => {
    const body = buildChatBody(req) as Record<string, unknown>;
    expect(body.stream).toBe(true);
  });

  test("tool_choice is auto", () => {
    const body = buildChatBody(req) as Record<string, unknown>;
    expect(body.tool_choice).toBe("auto");
  });

  test("model is passed through", () => {
    const body = buildChatBody(req) as Record<string, unknown>;
    expect(body.model).toBe("x/y");
  });
});

describe("parseOpenRouterStream — text deltas", () => {
  test("text deltas concatenate to full text and end with done", async () => {
    const lines = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello" }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: ", world" }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`,
      "data: [DONE]\n\n",
    ];
    const events = await collect(asChunks(lines));
    const textDeltas = events.filter((e) => e.type === "textDelta");
    const texts = textDeltas.map((e) => (e as { type: "textDelta"; text: string }).text);
    expect(texts.join("")).toBe("Hello, world");
    const doneEvent = events.find((e) => e.type === "done");
    expect(doneEvent).toBeDefined();
    expect((doneEvent as { type: "done"; finishReason: string }).finishReason).toBe("stop");
  });
});

describe("parseOpenRouterStream — tool call accumulation", () => {
  test("multi-delta tool call → ONE toolCallComplete with parsed args + correct id/name + done:tool_calls", async () => {
    const tc0 = (id?: string, name?: string, args?: string) => ({
      index: 0,
      id,
      type: "function",
      function: { name, arguments: args ?? "" },
    });

    const lines = [
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [tc0("call-abc", "get_timeline", '{"cl')] }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [tc0(undefined, undefined, 'ipId":"')] }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [tc0(undefined, undefined, 'c1"}')] }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })}\n\n`,
      "data: [DONE]\n\n",
    ];
    const events = await collect(asChunks(lines));

    const completes = events.filter((e) => e.type === "toolCallComplete");
    expect(completes).toHaveLength(1);
    const complete = completes[0] as { type: "toolCallComplete"; id: string; name: string; args: unknown };
    expect(complete.id).toBe("call-abc");
    expect(complete.name).toBe("get_timeline");
    expect(complete.args).toEqual({ clipId: "c1" });

    const done = events.find((e) => e.type === "done") as { type: "done"; finishReason: string } | undefined;
    expect(done).toBeDefined();
    expect(done!.finishReason).toBe("tool_calls");
  });

  test("toolCallComplete comes before done in the event sequence", async () => {
    const tc0 = (id?: string, name?: string, args?: string) => ({
      index: 0, id, type: "function", function: { name, arguments: args ?? "" },
    });
    const lines = [
      `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [tc0("call-1", "get_media", "{}")] }, finish_reason: null }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })}\n\n`,
      "data: [DONE]\n\n",
    ];
    const events = await collect(asChunks(lines));
    const completeIdx = events.findIndex((e) => e.type === "toolCallComplete");
    const doneIdx = events.findIndex((e) => e.type === "done");
    expect(completeIdx).toBeGreaterThanOrEqual(0);
    expect(doneIdx).toBeGreaterThan(completeIdx);
  });
});

describe("parseOpenRouterStream — split chunk", () => {
  test("data: line split across two chunks still parses correctly", async () => {
    const fullLine = `data: ${JSON.stringify({ choices: [{ delta: { content: "split!" }, finish_reason: null }] })}\n\n`;
    // Cut in the middle of the JSON
    const mid = Math.floor(fullLine.length / 2);
    const part1 = fullLine.slice(0, mid);
    const part2 = fullLine.slice(mid);
    const doneChunk = "data: [DONE]\n\n";
    const events = await collect(asChunks([part1, part2, doneChunk]));
    const textDeltas = events.filter((e) => e.type === "textDelta");
    expect(textDeltas).toHaveLength(1);
    expect((textDeltas[0] as { type: "textDelta"; text: string }).text).toBe("split!");
  });
});

describe("parseOpenRouterStream — malformed JSON", () => {
  test("malformed data line yields error event and stops", async () => {
    const lines = [
      "data: {not valid json}\n\n",
    ];
    const events = await collect(asChunks(lines));
    const errorEvents = events.filter((e) => e.type === "error");
    expect(errorEvents).toHaveLength(1);
    expect(typeof (errorEvents[0] as { type: "error"; message: string }).message).toBe("string");
  });
});
