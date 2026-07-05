import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamEvent } from "@frontstage/ai";
import { WebAiGateway } from "../src/web-ai-gateway.js";

// Canned SSE matching the proxy test fixture
const CANNED_SSE = [
  'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n',
  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"get_timeline","arguments":""}}]},"finish_reason":null}]}\n',
  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"a\\":1}"}}]},"finish_reason":null}]}\n',
  'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n',
  "data: [DONE]\n",
].join("");

function makeFakeReadableStream(text: string): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const bytes = enc.encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

describe("WebAiGateway", () => {
  let capturedInit: RequestInit | undefined;

  beforeEach(() => {
    capturedInit = undefined;
    vi.stubGlobal("fetch", async (_url: string, opts: RequestInit) => {
      capturedInit = opts;
      return {
        ok: true,
        status: 200,
        body: makeFakeReadableStream(CANNED_SSE),
      };
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("streamChat parses SSE stream into expected events", async () => {
    const gw = new WebAiGateway("http://localhost:8787");
    const events: StreamEvent[] = [];

    for await (const ev of gw.streamChat({
      model: "test-model",
      system: "You are a helpful assistant.",
      tools: [],
      messages: [],
    })) {
      events.push(ev);
    }

    const textDeltas = events.filter((e) => e.type === "textDelta");
    const toolCallCompletes = events.filter((e) => e.type === "toolCallComplete");
    const doneEvents = events.filter((e) => e.type === "done");

    expect(textDeltas.length).toBeGreaterThanOrEqual(1);
    expect((textDeltas[0] as { type: "textDelta"; text: string }).text).toBe("Hello");

    expect(toolCallCompletes.length).toBe(1);
    const tcc = toolCallCompletes[0] as { type: "toolCallComplete"; id: string; name: string; args: unknown };
    expect(tcc.id).toBe("call_1");
    expect(tcc.name).toBe("get_timeline");
    expect(tcc.args).toEqual({ a: 1 });

    expect(doneEvents.length).toBe(1);
    expect((doneEvents[0] as { type: "done"; finishReason: string }).finishReason).toBe("tool_calls");
  });

  it("streamChat throws when proxy returns non-ok status", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 502, body: null }));
    const gw = new WebAiGateway("http://localhost:8787");
    await expect(async () => {
      for await (const _ of gw.streamChat({ model: "x", system: "", tools: [], messages: [] })) { /* noop */ }
    }).rejects.toThrow("AI proxy error: 502");
  });

  it("without proxyToken — no Authorization header sent", async () => {
    const gw = new WebAiGateway("http://localhost:8787");
    for await (const _ of gw.streamChat({ model: "x", tools: [], messages: [] })) { /* drain */ }
    const headers = capturedInit?.headers as Record<string, string> | undefined;
    expect(headers?.["Authorization"]).toBeUndefined();
  });

  it("with proxyToken — Authorization: Bearer <token> sent", async () => {
    const gw = new WebAiGateway("http://localhost:8787", "my-tok");
    for await (const _ of gw.streamChat({ model: "x", tools: [], messages: [] })) { /* drain */ }
    const headers = capturedInit?.headers as Record<string, string> | undefined;
    expect(headers?.["Authorization"]).toBe("Bearer my-tok");
  });

  it("Content-Type is always application/json regardless of token", async () => {
    const gw = new WebAiGateway("http://localhost:8787", "tok");
    for await (const _ of gw.streamChat({ model: "x", tools: [], messages: [] })) { /* drain */ }
    const headers = capturedInit?.headers as Record<string, string> | undefined;
    expect(headers?.["Content-Type"]).toBe("application/json");
  });
});

describe("WebAiGateway relay mode", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("streamChat hits <origin>/api/v1/chat/completions with credentials included, X-OpenRouter-Key set, no Authorization header", async () => {
    let capturedUrl: string | undefined;
    let capturedInit: RequestInit | undefined;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return { ok: true, status: 200, body: makeFakeReadableStream("data: [DONE]\n") };
    });

    const gw = new WebAiGateway({ origin: "https://frontstage.studio", getKeys: () => ({ openRouterKey: "or-secret" }) });
    for await (const _ of gw.streamChat({ model: "x", tools: [], messages: [] })) { /* drain */ }

    expect(capturedUrl).toBe("https://frontstage.studio/api/v1/chat/completions");
    expect(capturedInit?.credentials).toBe("include");
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["X-OpenRouter-Key"]).toBe("or-secret");
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("omits X-OpenRouter-Key when getKeys() has no openRouterKey", async () => {
    let capturedInit: RequestInit | undefined;
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      capturedInit = init;
      return { ok: true, status: 200, body: makeFakeReadableStream("data: [DONE]\n") };
    });

    const gw = new WebAiGateway({ origin: "", getKeys: () => ({}) });
    for await (const _ of gw.streamChat({ model: "x", tools: [], messages: [] })) { /* drain */ }
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["X-OpenRouter-Key"]).toBeUndefined();
  });

  it("an empty relay origin (same-origin default) resolves to a bare /api path", async () => {
    let capturedUrl: string | undefined;
    vi.stubGlobal("fetch", async (url: string) => {
      capturedUrl = url;
      return { ok: true, status: 200, body: makeFakeReadableStream("data: [DONE]\n") };
    });

    const gw = new WebAiGateway({ origin: "", getKeys: () => ({}) });
    for await (const _ of gw.streamChat({ model: "x", tools: [], messages: [] })) { /* drain */ }
    expect(capturedUrl).toBe("/api/v1/chat/completions");
  });
});
