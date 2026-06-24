import type { OpenAIMessage } from "./wire.js";
import type { ToolBlock } from "../tools/types.js";

export type AgentContentBlock =
  | { kind: "text"; text: string }
  | { kind: "toolCall"; id: string; name: string; argsJson: string }
  | { kind: "toolResult"; toolCallId: string; blocks: ToolBlock[]; isError: boolean };

export interface AgentMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: AgentContentBlock[];
}

export function toolResultToText(blocks: ToolBlock[]): string {
  return blocks
    .map((b) => (b.kind === "text" ? b.text : "[image]"))
    .join("\n");
}

export function toWireMessages(messages: AgentMessage[]): OpenAIMessage[] {
  return messages.flatMap((msg): OpenAIMessage[] => {
    if (msg.role === "user") {
      const text = msg.content
        .filter((b): b is { kind: "text"; text: string } => b.kind === "text")
        .map((b) => b.text)
        .join("\n");
      return [{ role: "user", content: text }];
    }

    if (msg.role === "assistant") {
      const textBlocks = msg.content.filter(
        (b): b is { kind: "text"; text: string } => b.kind === "text",
      );
      const toolCallBlocks = msg.content.filter(
        (b): b is { kind: "toolCall"; id: string; name: string; argsJson: string } =>
          b.kind === "toolCall",
      );
      const content = textBlocks.length > 0 ? textBlocks.map((b) => b.text).join("\n") : null;
      const wire: OpenAIMessage = { role: "assistant", content };
      if (toolCallBlocks.length > 0) {
        wire.tool_calls = toolCallBlocks.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.argsJson },
        }));
      }
      return [wire];
    }

    // role === "tool": one wire message per toolResult block
    return msg.content
      .filter(
        (b): b is { kind: "toolResult"; toolCallId: string; blocks: ToolBlock[]; isError: boolean } =>
          b.kind === "toolResult",
      )
      .map((b) => ({
        role: "tool" as const,
        content: toolResultToText(b.blocks),
        tool_call_id: b.toolCallId,
      }));
  });
}
