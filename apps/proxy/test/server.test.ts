import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProxyServer } from "../src/server.js";

// Canned SSE payload the fake upstream returns
const CANNED_SSE = [
  'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}',
  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"get_timeline","arguments":""}}]},"finish_reason":null}]}',
  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"a\\":1}"}}]},"finish_reason":null}]}',
  'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
  "data: [DONE]",
].join("\n") + "\n";

function startFakeUpstream(): Promise<{ server: http.Server; port: number; lastAuthHeader: () => string | undefined }> {
  return new Promise((resolve) => {
    let lastAuth: string | undefined;
    const server = http.createServer((req, res) => {
      lastAuth = req.headers["authorization"];
      if (req.url === "/chat/completions" && req.method === "POST") {
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
        res.end(CANNED_SSE);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({ server, port: addr.port, lastAuthHeader: () => lastAuth });
    });
  });
}

function startProxy(upstreamPort: number): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = createProxyServer({
      apiKey: "secret-xyz",
      upstreamBaseUrl: `http://127.0.0.1:${upstreamPort}`,
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({ server, port: addr.port });
    });
  });
}

function httpRequest(options: http.RequestOptions, body?: string): Promise<{ status: number; headers: http.IncomingMessage["headers"]; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf-8") }));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

describe("createProxyServer", () => {
  let fakeUpstream: { server: http.Server; port: number; lastAuthHeader: () => string | undefined };
  let proxy: { server: http.Server; port: number };

  beforeAll(async () => {
    fakeUpstream = await startFakeUpstream();
    proxy = await startProxy(fakeUpstream.port);
  });

  afterAll(() => {
    proxy.server.close();
    fakeUpstream.server.close();
  });

  it("GET /healthz → 200 ok", async () => {
    const res = await httpRequest({ host: "127.0.0.1", port: proxy.port, path: "/healthz", method: "GET" });
    expect(res.status).toBe(200);
    expect(res.body).toBe("ok");
  });

  it("OPTIONS → 204 + CORS headers", async () => {
    const res = await httpRequest({ host: "127.0.0.1", port: proxy.port, path: "/v1/chat/completions", method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.headers["access-control-allow-methods"]).toMatch(/POST/);
  });

  it("POST /v1/chat/completions → streams SSE, upstream sees Authorization header", async () => {
    const chatBody = JSON.stringify({ model: "test", messages: [], tools: [], stream: true });
    const res = await httpRequest(
      {
        host: "127.0.0.1",
        port: proxy.port,
        path: "/v1/chat/completions",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(chatBody) },
      },
      chatBody,
    );

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
    expect(res.body).toContain("data:");
    expect(res.body).toContain("[DONE]");
    // Upstream saw the API key
    expect(fakeUpstream.lastAuthHeader()).toBe("Bearer secret-xyz");
  });

  it("key-not-leaked: 'secret-xyz' does NOT appear in proxy response headers or body", async () => {
    const chatBody = JSON.stringify({ model: "test", messages: [], tools: [], stream: true });
    const res = await httpRequest(
      {
        host: "127.0.0.1",
        port: proxy.port,
        path: "/v1/chat/completions",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(chatBody) },
      },
      chatBody,
    );

    // Check body
    expect(res.body).not.toContain("secret-xyz");
    // Check headers
    const headerValues = Object.values(res.headers).join(" ");
    expect(headerValues).not.toContain("secret-xyz");
  });

  it("unknown route → 404", async () => {
    const res = await httpRequest({ host: "127.0.0.1", port: proxy.port, path: "/unknown", method: "GET" });
    expect(res.status).toBe(404);
  });
});

describe("createProxyServer — trailing-slash base URL normalization", () => {
  let fakeUpstream: { server: http.Server; port: number; lastUrl: () => string | undefined };
  let proxy: { server: http.Server; port: number };

  beforeAll(async () => {
    let captured: string | undefined;
    const server = http.createServer((req, res) => {
      captured = req.url;
      if (req.url === "/chat/completions" && req.method === "POST") {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end('data: [DONE]\n');
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address() as { port: number };
    fakeUpstream = { server, port: addr.port, lastUrl: () => captured };

    // Intentional trailing slash — must not produce //chat/completions
    const proxyServer = createProxyServer({
      apiKey: "k",
      upstreamBaseUrl: `http://127.0.0.1:${addr.port}/`,
    });
    await new Promise<void>((resolve) => proxyServer.listen(0, "127.0.0.1", () => resolve()));
    proxy = { server: proxyServer, port: (proxyServer.address() as { port: number }).port };
  });

  afterAll(() => {
    proxy.server.close();
    fakeUpstream.server.close();
  });

  it("trailing-slash base URL: upstream receives /chat/completions not //chat/completions", async () => {
    const chatBody = JSON.stringify({ model: "test", messages: [], stream: true });
    await httpRequest(
      {
        host: "127.0.0.1",
        port: proxy.port,
        path: "/v1/chat/completions",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(chatBody) },
      },
      chatBody,
    );
    expect(fakeUpstream.lastUrl()).toBe("/chat/completions");
  });
});
