import { buildChatBody, parseOpenRouterStream, buildImageBody, parseImageResponse } from "@palmier/ai";
import type { AiGateway, ChatRequest, StreamEvent, ImageRequest, ImageResult } from "@palmier/ai";

export class WebAiGateway implements AiGateway {
  constructor(private proxyUrl: string, private proxyToken?: string) {}

  async generateImage(req: ImageRequest): Promise<ImageResult> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.proxyToken) headers["Authorization"] = "Bearer " + this.proxyToken;
    const res = await fetch(this.proxyUrl + "/v1/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify(buildImageBody(req)),
    });
    if (!res.ok) throw new Error("AI proxy error: " + res.status);
    return parseImageResponse(await res.json());
  }

  async *streamChat(req: ChatRequest): AsyncIterable<StreamEvent> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.proxyToken) headers["Authorization"] = "Bearer " + this.proxyToken;

    const res = await fetch(this.proxyUrl + "/v1/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify(buildChatBody(req)),
    });
    if (!res.ok || !res.body) throw new Error("AI proxy error: " + res.status);
    yield* parseOpenRouterStream(res.body);
  }
}
