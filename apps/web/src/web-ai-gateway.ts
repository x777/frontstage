import { buildChatBody, parseOpenRouterStream, buildImageBody, parseImageResponse } from "@frontstage/ai";
import type { AiGateway, ChatRequest, StreamEvent, ImageRequest, ImageResult } from "@frontstage/ai";
import type { UserKeys } from "./relay-config.js";

// Relay mode config (M18C T2): base = relayOrigin + "/api", the user's OpenRouter key rides a
// header instead of a proxy bearer token, and the request carries the fs_session cookie.
export interface RelayGatewayConfig {
  origin: string;
  getKeys: () => UserKeys;
}

export class WebAiGateway implements AiGateway {
  private readonly mode: "proxy" | "relay";
  private readonly proxyUrl?: string;
  private readonly proxyToken?: string;
  private readonly relayOrigin?: string;
  private readonly getKeys?: () => UserKeys;

  constructor(proxyUrl: string, proxyToken?: string);
  constructor(config: RelayGatewayConfig);
  constructor(proxyUrlOrConfig: string | RelayGatewayConfig, proxyToken?: string) {
    if (typeof proxyUrlOrConfig === "string") {
      this.mode = "proxy";
      this.proxyUrl = proxyUrlOrConfig;
      this.proxyToken = proxyToken;
    } else {
      this.mode = "relay";
      this.relayOrigin = proxyUrlOrConfig.origin;
      this.getKeys = proxyUrlOrConfig.getKeys;
    }
  }

  private base(): string {
    return this.mode === "relay" ? `${this.relayOrigin}/api` : this.proxyUrl!;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.mode === "relay") {
      const key = this.getKeys!().openRouterKey;
      if (key) headers["X-OpenRouter-Key"] = key;
    } else if (this.proxyToken) {
      headers["Authorization"] = "Bearer " + this.proxyToken;
    }
    return headers;
  }

  private requestInit(init: RequestInit): RequestInit {
    return this.mode === "relay" ? { ...init, credentials: "include" } : init;
  }

  async generateImage(req: ImageRequest): Promise<ImageResult> {
    const res = await fetch(
      this.base() + "/v1/chat/completions",
      this.requestInit({ method: "POST", headers: this.headers(), body: JSON.stringify(buildImageBody(req)) }),
    );
    if (!res.ok) throw new Error("AI proxy error: " + res.status);
    return parseImageResponse(await res.json());
  }

  async *streamChat(req: ChatRequest): AsyncIterable<StreamEvent> {
    const res = await fetch(
      this.base() + "/v1/chat/completions",
      this.requestInit({ method: "POST", headers: this.headers(), body: JSON.stringify(buildChatBody(req)) }),
    );
    if (!res.ok || !res.body) throw new Error("AI proxy error: " + res.status);
    yield* parseOpenRouterStream(res.body);
  }
}
