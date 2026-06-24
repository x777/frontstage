import type { AiGateway, ChatRequest } from "./wire.js";
import type { AgentMessage } from "./conversation.js";
import { toWireMessages } from "./conversation.js";
import { DEFAULT_SYSTEM_PROMPT } from "./system-prompt.js";
import type { ToolExecutor } from "../tools/executor.js";
import type { ToolSpec } from "../tools/types.js";
import type { ChatSessionDoc } from "./session-store.js";

export interface AgentSessionDeps {
  gateway: AiGateway;
  executor: ToolExecutor;
  tools: ToolSpec[];
  model: string;
  systemPrompt?: string;
  maxTurns?: number;
  newId?: () => string;
  id?: string;
  now?: () => string;
}

export interface StreamingDraft {
  text: string;
  toolCalls: { id: string; name: string }[];
}

export type AgentStatus = "idle" | "streaming" | "tools" | "error";

export interface AgentSessionState {
  messages: AgentMessage[];
  streaming: StreamingDraft | null;
  status: AgentStatus;
  error?: string;
}

export interface MentionContext {
  text?: string;
  images?: { base64: string; mediaType: string }[];
}

export class AgentSession {
  private readonly gateway: AiGateway;
  private readonly executor: ToolExecutor;
  private readonly tools: ToolSpec[];
  private readonly model: string;
  private readonly systemPrompt: string;
  private readonly maxTurns: number;
  private readonly newId: () => string;

  id: string;
  createdAt: string;

  private messages: AgentMessage[] = [];
  private streaming: StreamingDraft | null = null;
  private status: AgentStatus = "idle";
  private error: string | undefined = undefined;
  private cancelled = false;
  private readonly subscribers = new Set<() => void>();

  constructor(deps: AgentSessionDeps) {
    this.gateway = deps.gateway;
    this.executor = deps.executor;
    this.tools = deps.tools;
    this.model = deps.model;
    this.systemPrompt = deps.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    this.maxTurns = deps.maxTurns ?? 20;
    this.newId = deps.newId ?? (() => crypto.randomUUID());
    const now = deps.now ?? (() => new Date().toISOString());
    this.id = deps.id ?? this.newId();
    this.createdAt = now();
  }

  toDoc(): ChatSessionDoc {
    const firstUserMsg = this.messages.find((m) => m.role === "user");
    let title = "New Chat";
    if (firstUserMsg) {
      const textBlock = firstUserMsg.content.find((b) => b.kind === "text");
      if (textBlock && textBlock.kind === "text") {
        const raw = textBlock.text.trim();
        title = raw.length > 60 ? raw.slice(0, 60) + "..." : raw;
      }
    }
    return {
      id: this.id,
      title,
      createdAt: this.createdAt,
      messages: [...this.messages],
    };
  }

  loadDoc(doc: ChatSessionDoc): void {
    this.id = doc.id;
    this.createdAt = doc.createdAt;
    this.messages = [...doc.messages];
    this.streaming = null;
    this.status = "idle";
    this.error = undefined;
    this.emit();
  }

  getState(): AgentSessionState {
    return {
      messages: [...this.messages],
      streaming: this.streaming ? { ...this.streaming } : null,
      status: this.status,
      error: this.error,
    };
  }

  subscribe(cb: () => void): () => void {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  private emit(): void {
    for (const cb of this.subscribers) cb();
  }

  async send(userText: string, context?: MentionContext): Promise<void> {
    try {
      // build user message content
      let fullText = userText;
      if (context?.text) {
        fullText = `${context.text}\n${userText}`;
      }
      if (context?.images && context.images.length > 0) {
        const markers = context.images.map((img) => `[image: ${img.mediaType}]`).join(" ");
        fullText = `${fullText}\n${markers}`;
      }

      const userMsg: AgentMessage = {
        id: this.newId(),
        role: "user",
        content: [{ kind: "text", text: fullText }],
      };
      this.messages.push(userMsg);
      this.emit();

      this.cancelled = false;
      await this.runLoop();
    } catch (err) {
      this.status = "error";
      this.error = String(err);
      this.emit();
    }
  }

  cancel(): void {
    // cannot abort the in-flight HTTP stream (the gateway has no cancel); stops the agentic loop from continuing
    this.cancelled = true;
  }

  private async runLoop(): Promise<void> {
    let turn = 0;

    while (true) {
      if (this.cancelled) {
        this.status = "idle";
        this.streaming = null;
        this.emit();
        return;
      }
      if (turn++ >= this.maxTurns) {
        this.status = "error";
        this.error = "max turns exceeded";
        this.emit();
        return;
      }

      this.status = "streaming";
      this.streaming = { text: "", toolCalls: [] };
      this.emit();

      const req: ChatRequest = {
        model: this.model,
        system: this.systemPrompt,
        tools: this.tools,
        messages: toWireMessages(this.messages),
      };

      let finishReason = "unknown";
      const calls: { id: string; name: string; args: unknown }[] = [];
      let hadError = false;

      for await (const ev of this.gateway.streamChat(req)) {
        if (this.cancelled) break;

        if (ev.type === "textDelta") {
          this.streaming!.text += ev.text;
          this.emit();
        } else if (ev.type === "toolCallComplete") {
          calls.push({ id: ev.id, name: ev.name, args: ev.args });
          this.streaming!.toolCalls.push({ id: ev.id, name: ev.name });
          this.emit();
        } else if (ev.type === "done") {
          finishReason = ev.finishReason;
        } else if (ev.type === "error") {
          this.status = "error";
          this.error = ev.message;
          this.streaming = null;
          this.emit();
          hadError = true;
          break;
        }
      }

      if (hadError) return;

      // build and push the assistant message
      const assistantContent: AgentMessage["content"] = [];
      if (this.streaming!.text) {
        assistantContent.push({ kind: "text", text: this.streaming!.text });
      }
      for (const c of calls) {
        assistantContent.push({
          kind: "toolCall",
          id: c.id,
          name: c.name,
          argsJson: JSON.stringify(c.args),
        });
      }
      this.messages.push({
        id: this.newId(),
        role: "assistant",
        content: assistantContent,
      });
      this.streaming = null;
      this.emit();

      if (this.cancelled) {
        this.status = "idle";
        this.emit();
        return;
      }

      if (finishReason !== "tool_calls" || calls.length === 0) {
        this.status = "idle";
        this.emit();
        return;
      }

      // execute tools
      this.status = "tools";
      this.emit();

      const toolContent: AgentMessage["content"] = [];
      for (const c of calls) {
        const result = await this.executor.execute(c.name, c.args);
        toolContent.push({
          kind: "toolResult",
          toolCallId: c.id,
          blocks: result.blocks,
          isError: result.isError,
        });
        this.emit();
      }

      this.messages.push({
        id: this.newId(),
        role: "tool",
        content: toolContent,
      });
      this.emit();
      // loop back
    }
  }
}
