import { buildChatBody, parseOpenRouterStream, buildImageBody, parseImageResponse } from "@frontstage/ai";
import type { AiGateway, ChatRequest, StreamEvent, ImageRequest, ImageResult } from "@frontstage/ai";

export type AiKeyProvider = "openrouter" | "fal";

interface DesktopAIBridge {
  setKey(key: string, provider?: AiKeyProvider): Promise<void>;
  hasKey(provider?: AiKeyProvider): Promise<boolean>;
  clearKey(provider?: AiKeyProvider): Promise<void>;
  streamChat(id: string, body: object): void;
  onChunk(cb: (msg: { id: string; data?: Uint8Array; done?: boolean; error?: string }) => void): () => void;
  generateImage(body: object): Promise<unknown>;
}

declare global {
  interface Window {
    desktopAI: DesktopAIBridge;
  }
}

export class DesktopAiGateway implements AiGateway {
  async generateImage(req: ImageRequest): Promise<ImageResult> {
    return parseImageResponse(await window.desktopAI.generateImage(buildImageBody(req)));
  }

  async *streamChat(req: ChatRequest): AsyncIterable<StreamEvent> {
    const body = buildChatBody(req);
    const id = crypto.randomUUID();

    // Chunk queue → async iterable adapter
    type QueueItem = { data: Uint8Array } | { done: true } | { error: string };
    const queue: QueueItem[] = [];
    let resolveNext: (() => void) | null = null;
    let finished = false;

    const unsub = window.desktopAI.onChunk((msg) => {
      if (msg.id !== id) return;
      if (msg.error) {
        queue.push({ error: msg.error });
      } else if (msg.done) {
        queue.push({ done: true });
      } else if (msg.data) {
        queue.push({ data: msg.data });
      }
      if (resolveNext) {
        const r = resolveNext;
        resolveNext = null;
        r();
      }
    });

    // Kick off streaming in main
    window.desktopAI.streamChat(id, body);

    async function* byteStream(): AsyncIterable<Uint8Array> {
      try {
        while (true) {
          if (queue.length === 0 && !finished) {
            await new Promise<void>((resolve) => { resolveNext = resolve; });
          }
          if (queue.length === 0) break;
          const item = queue.shift()!;
          if ("error" in item) throw new Error(item.error);
          if ("done" in item) { finished = true; break; }
          yield item.data;
        }
      } finally {
        unsub();
      }
    }

    yield* parseOpenRouterStream(byteStream());
  }
}
