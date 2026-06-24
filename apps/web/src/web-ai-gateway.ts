import { buildChatBody, parseOpenRouterStream } from "@palmier/ai";
import type { AiGateway, ChatRequest, StreamEvent } from "@palmier/ai";

export class WebAiGateway implements AiGateway {
  constructor(private proxyUrl: string) {}

  async *streamChat(req: ChatRequest): AsyncIterable<StreamEvent> {
    const res = await fetch(this.proxyUrl + "/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildChatBody(req)),
    });
    if (!res.ok || !res.body) throw new Error("AI proxy error: " + res.status);
    yield* parseOpenRouterStream(res.body);
  }
}
