import zodToJsonSchema from "zod-to-json-schema";
import type { ToolSpec } from "../tools/types.js";
import type { ChatRequest, StreamEvent } from "./wire.js";

export function toolsToOpenAI(tools: ToolSpec[]): {
  type: "function";
  function: { name: string; description: string; parameters: object };
}[] {
  return tools.map((t) => {
    const parameters = zodToJsonSchema(t.inputSchema, { $refStrategy: "none" }) as Record<string, unknown>;
    delete parameters["$schema"];
    return {
      type: "function" as const,
      function: { name: t.name, description: t.description, parameters },
    };
  });
}

export function buildChatBody(req: ChatRequest): object {
  return {
    model: req.model,
    messages: [{ role: "system", content: req.system }, ...req.messages],
    tools: toolsToOpenAI(req.tools),
    tool_choice: "auto",
    stream: true,
  };
}

type AccumulatedCall = { id: string; name: string; argsBuffer: string };

function mapFinishReason(r: string | null | undefined): "stop" | "tool_calls" | "length" | "unknown" {
  if (r === "stop") return "stop";
  if (r === "tool_calls") return "tool_calls";
  if (r === "length") return "length";
  return "unknown";
}

export async function* parseOpenRouterStream(
  input: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>,
): AsyncGenerator<StreamEvent> {
  // Normalize to async iterable of Uint8Array
  async function* toAsyncIterable(): AsyncGenerator<Uint8Array> {
    if (Symbol.asyncIterator in (input as object)) {
      yield* input as AsyncIterable<Uint8Array>;
    } else {
      const stream = input as ReadableStream<Uint8Array>;
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          yield value;
        }
      } finally {
        reader.releaseLock();
      }
    }
  }

  const decoder = new TextDecoder(undefined, { fatal: false });
  let buffer = "";
  const callMap = new Map<number, AccumulatedCall>();
  let finishReason: string | null = null;
  let finished = false;

  // Helper to emit accumulated tool call completes + done
  function* emitFinish(): Generator<StreamEvent> {
    for (const [, call] of [...callMap.entries()].sort(([a], [b]) => a - b)) {
      let args: unknown = {};
      try {
        args = JSON.parse(call.argsBuffer || "{}");
      } catch {
        args = {};
      }
      yield { type: "toolCallComplete", id: call.id, name: call.name, args };
    }
    yield { type: "done", finishReason: mapFinishReason(finishReason) };
  }

  for await (const chunk of toAsyncIterable()) {
    if (finished) continue;
    buffer += decoder.decode(chunk, { stream: true });

    // Split on newlines but keep trailing incomplete line in buffer
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const rawLine of lines) {
      if (finished) break;
      const line = rawLine.trim();
      if (!line || !line.startsWith("data:")) continue;
      const data = line.slice(5).trim();

      if (data === "[DONE]") {
        yield* emitFinish();
        finished = true;
        break;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch (err) {
        yield { type: "error", message: err instanceof Error ? err.message : String(err) };
        finished = true;
        break;
      }

      const parsedChunk = parsed as {
        choices?: {
          delta?: {
            content?: string | null;
            tool_calls?: {
              index: number;
              id?: string;
              type?: string;
              function?: { name?: string; arguments?: string };
            }[];
          };
          finish_reason?: string | null;
        }[];
      };

      const choice = parsedChunk.choices?.[0];
      if (!choice) continue;

      const delta = choice.delta;
      if (delta) {
        if (typeof delta.content === "string" && delta.content !== "") {
          yield { type: "textDelta", text: delta.content };
        }

        for (const tc of delta.tool_calls ?? []) {
          const { index, id, function: fn } = tc;
          const name = fn?.name;
          const argsFragment = fn?.arguments ?? "";

          if (!callMap.has(index)) {
            callMap.set(index, { id: id ?? "", name: name ?? "", argsBuffer: argsFragment });
          } else {
            const existing = callMap.get(index)!;
            if (id) existing.id = id;
            if (name) existing.name = name;
            existing.argsBuffer += argsFragment;
          }

          yield {
            type: "toolCallDelta",
            index,
            ...(id !== undefined && { id }),
            ...(name !== undefined && { name }),
            ...(argsFragment !== "" && { argsFragment }),
          };
        }
      }

      if (choice.finish_reason != null) {
        finishReason = choice.finish_reason;
      }
    }
  }

  if (!finished) {
    // Flush trailing buffer line (in case stream ended without a final newline)
    const trailing = buffer.trim();
    if (trailing.startsWith("data:")) {
      const data = trailing.slice(5).trim();
      if (data && data !== "[DONE]") {
        let parsed: unknown;
        try {
          parsed = JSON.parse(data);
        } catch (err) {
          yield { type: "error", message: err instanceof Error ? err.message : String(err) };
          return;
        }
        const choice = (parsed as { choices?: { finish_reason?: string | null }[] }).choices?.[0];
        if (choice?.finish_reason != null) finishReason = choice.finish_reason;
      }
    }

    yield* emitFinish();
  }
}
