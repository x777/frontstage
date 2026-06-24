import type { ToolSpec } from "../tools/types.js";

export interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
}

export interface ChatRequest {
  model: string;
  system: string;
  tools: ToolSpec[];
  messages: OpenAIMessage[];
}

export type StreamEvent =
  | { type: "textDelta"; text: string }
  | { type: "toolCallDelta"; index: number; id?: string; name?: string; argsFragment?: string }
  | { type: "toolCallComplete"; id: string; name: string; args: unknown }
  | { type: "done"; finishReason: "stop" | "tool_calls" | "length" | "unknown" }
  | { type: "error"; message: string };

export interface AiGateway {
  streamChat(req: ChatRequest): AsyncIterable<StreamEvent>;
}
