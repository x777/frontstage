import http from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createProxyServer } from "../src/server.js";

const TEST_ORIGIN = "https://app.example.com";

// Canned SSE payload the fake upstream returns
const CANNED_SSE = [
  'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}',
  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"get_timeline","arguments":""}}]},"finish_reason":null}]}',
  'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"a\\":1}"}}]},"finish_reason":null}]}',
  'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}',
  "data: [DONE]",
].join("\n") + "\n";

function startFakeUpstream(): Promise<{ server: http.Server; port: number; lastAuthHeader: () => string | undefined; callCount: () => number }> {
  return new Promise((resolve) => {
    let lastAuth: string | undefined;
    let calls = 0;
    const server = http.createServer((req, res) => {
      lastAuth = req.headers["authorization"];
      calls++;
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
      resolve({ server, port: addr.port, lastAuthHeader: () => lastAuth, callCount: () => calls });
    });
  });
}

function startProxy(upstreamPort: number, extra?: Partial<Parameters<typeof createProxyServer>[0]>): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = createProxyServer({
      apiKey: "secret-xyz",
      upstreamBaseUrl: `http://127.0.0.1:${upstreamPort}`,
      allowOrigin: TEST_ORIGIN,
      ...extra,
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

// ── Construction guards ──────────────────────────────────────────────────────

describe("createProxyServer — construction guards", () => {
  it("throws when allowOrigin is '*'", () => {
    expect(() =>
      createProxyServer({ apiKey: "k", allowOrigin: "*" }),
    ).toThrow("allowOrigin must be a specific origin (not '*')");
  });

  it("throws when allowOrigin is empty string", () => {
    expect(() =>
      createProxyServer({ apiKey: "k", allowOrigin: "" }),
    ).toThrow("allowOrigin must be a specific origin (not '*')");
  });
});

// ── CORS headers reflect specific origin ────────────────────────────────────

describe("createProxyServer — CORS headers", () => {
  let fakeUpstream: { server: http.Server; port: number; lastAuthHeader: () => string | undefined; callCount: () => number };
  let proxy: { server: http.Server; port: number };

  beforeAll(async () => {
    fakeUpstream = await startFakeUpstream();
    proxy = await startProxy(fakeUpstream.port);
  });

  afterAll(() => {
    proxy.server.close();
    fakeUpstream.server.close();
  });

  it("OPTIONS → 204 + specific origin (not *) + Authorization in allow-headers", async () => {
    const res = await httpRequest({ host: "127.0.0.1", port: proxy.port, path: "/v1/chat/completions", method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(TEST_ORIGIN);
    expect(res.headers["access-control-allow-origin"]).not.toBe("*");
    expect(res.headers["access-control-allow-headers"]).toMatch(/Authorization/i);
  });

  it("POST → response carries specific origin", async () => {
    const chatBody = JSON.stringify({ model: "test", messages: [], stream: true });
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
    expect(res.headers["access-control-allow-origin"]).toBe(TEST_ORIGIN);
    expect(res.headers["access-control-allow-origin"]).not.toBe("*");
  });
});

// ── Main proxy behaviour ─────────────────────────────────────────────────────

describe("createProxyServer", () => {
  let fakeUpstream: { server: http.Server; port: number; lastAuthHeader: () => string | undefined; callCount: () => number };
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
    expect(res.headers["access-control-allow-origin"]).toBe(TEST_ORIGIN);
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

// ── Token authentication ─────────────────────────────────────────────────────

describe("createProxyServer — proxyToken auth", () => {
  let fakeUpstream: { server: http.Server; port: number; lastAuthHeader: () => string | undefined; callCount: () => number };
  let proxy: { server: http.Server; port: number };
  const TOKEN = "my-secret-token";

  beforeAll(async () => {
    fakeUpstream = await startFakeUpstream();
    proxy = await startProxy(fakeUpstream.port, { proxyToken: TOKEN });
  });

  afterAll(() => {
    proxy.server.close();
    fakeUpstream.server.close();
  });

  it("POST without Authorization → 401, upstream NOT called", async () => {
    const before = fakeUpstream.callCount();
    const chatBody = JSON.stringify({ model: "test", messages: [], stream: true });
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
    expect(res.status).toBe(401);
    expect(fakeUpstream.callCount()).toBe(before); // upstream not called
  });

  it("POST with wrong token → 401, upstream NOT called", async () => {
    const before = fakeUpstream.callCount();
    const chatBody = JSON.stringify({ model: "test", messages: [], stream: true });
    const res = await httpRequest(
      {
        host: "127.0.0.1",
        port: proxy.port,
        path: "/v1/chat/completions",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(chatBody),
          Authorization: "Bearer wrong-token",
        },
      },
      chatBody,
    );
    expect(res.status).toBe(401);
    expect(fakeUpstream.callCount()).toBe(before);
  });

  it("POST with correct token → forwarded + streamed", async () => {
    const chatBody = JSON.stringify({ model: "test", messages: [], stream: true });
    const res = await httpRequest(
      {
        host: "127.0.0.1",
        port: proxy.port,
        path: "/v1/chat/completions",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(chatBody),
          Authorization: `Bearer ${TOKEN}`,
        },
      },
      chatBody,
    );
    expect(res.status).toBe(200);
    expect(res.body).toContain("[DONE]");
    // Upstream saw the API key (not the proxy token)
    expect(fakeUpstream.lastAuthHeader()).toBe("Bearer secret-xyz");
  });

  it("401 response includes specific CORS origin", async () => {
    const chatBody = JSON.stringify({ model: "test", messages: [], stream: true });
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
    expect(res.status).toBe(401);
    expect(res.headers["access-control-allow-origin"]).toBe(TEST_ORIGIN);
  });
});

// ── fal.ai upstream routes ───────────────────────────────────────────────────

function startFakeFalUpstream(): Promise<{
  server: http.Server;
  port: number;
  lastAuthHeader: () => string | undefined;
  lastPath: () => string | undefined;
  statusSequence: string[];
}> {
  return new Promise((resolve) => {
    let lastAuth: string | undefined;
    let lastPath: string | undefined;
    const statusSequence = ["IN_PROGRESS", "COMPLETED"];
    let statusCallCount = 0;
    const server = http.createServer((req, res) => {
      lastAuth = req.headers["authorization"];
      lastPath = req.url;

      if (req.method === "POST" && req.url === "/fal-ai/veo3/fast") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ request_id: "job-123" }));
        return;
      }
      if (req.method === "GET" && req.url === "/fal-ai/veo3/fast/requests/job-123/status") {
        const status = statusSequence[Math.min(statusCallCount, statusSequence.length - 1)];
        statusCallCount++;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status }));
        return;
      }
      if (req.method === "GET" && req.url === "/fal-ai/veo3/fast/requests/job-123") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ video: { url: "https://v3.fal.media/files/result.mp4" } }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({
        server,
        port: addr.port,
        lastAuthHeader: () => lastAuth,
        lastPath: () => lastPath,
        statusSequence,
      });
    });
  });
}

describe("createProxyServer — fal routes", () => {
  let falUpstream: Awaited<ReturnType<typeof startFakeFalUpstream>>;
  let proxy: { server: http.Server; port: number };

  beforeAll(async () => {
    falUpstream = await startFakeFalUpstream();
    proxy = await new Promise((resolve) => {
      const server = createProxyServer({
        apiKey: "secret-xyz",
        allowOrigin: TEST_ORIGIN,
        falKey: "fal-secret-key",
        falUpstream: `http://127.0.0.1:${falUpstream.port}`,
      });
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as { port: number };
        resolve({ server, port: addr.port });
      });
    });
  });

  afterAll(() => {
    proxy.server.close();
    falUpstream.server.close();
  });

  it("GET /fal/enabled → {enabled:true} when falKey configured", async () => {
    const res = await httpRequest({ host: "127.0.0.1", port: proxy.port, path: "/fal/enabled", method: "GET" });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ enabled: true });
  });

  it("POST /fal/submit → forwards to falUpstream/{modelEndpoint} with Authorization: Key <falKey>", async () => {
    const body = JSON.stringify({ modelEndpoint: "fal-ai/veo3/fast", input: { prompt: "a cat" } });
    const res = await httpRequest(
      {
        host: "127.0.0.1",
        port: proxy.port,
        path: "/fal/submit",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      body,
    );
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ request_id: "job-123" });
    expect(falUpstream.lastAuthHeader()).toBe("Key fal-secret-key");
    expect(falUpstream.lastPath()).toBe("/fal-ai/veo3/fast");
  });

  it("POST /fal/submit with '..' in modelEndpoint → 400, upstream NOT called", async () => {
    const body = JSON.stringify({ modelEndpoint: "../../etc/passwd", input: {} });
    const res = await httpRequest(
      {
        host: "127.0.0.1",
        port: proxy.port,
        path: "/fal/submit",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      body,
    );
    expect(res.status).toBe(400);
  });

  it("GET /fal/status → {status} for IN_PROGRESS (one upstream call)", async () => {
    const res = await httpRequest({
      host: "127.0.0.1",
      port: proxy.port,
      path: "/fal/status?model=fal-ai%2Fveo3%2Ffast&job=job-123",
      method: "GET",
    });
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.status).toEqual({ status: "IN_PROGRESS" });
    expect(parsed.resultJson).toBeUndefined();
  });

  it("GET /fal/status → {status, resultJson} for COMPLETED (two upstream calls)", async () => {
    const res = await httpRequest({
      host: "127.0.0.1",
      port: proxy.port,
      path: "/fal/status?model=fal-ai%2Fveo3%2Ffast&job=job-123",
      method: "GET",
    });
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.status).toEqual({ status: "COMPLETED" });
    expect(parsed.resultJson).toEqual({ video: { url: "https://v3.fal.media/files/result.mp4" } });
  });

  describe("GET /fal/download — SSRF guard", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("https://evil.com/x → 400, no upstream fetch attempted", async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      const res = await httpRequest({
        host: "127.0.0.1",
        port: proxy.port,
        path: "/fal/download?url=" + encodeURIComponent("https://evil.com/x"),
        method: "GET",
      });
      expect(res.status).toBe(400);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("http://fal.media/x (not https) → 400, no upstream fetch attempted", async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      const res = await httpRequest({
        host: "127.0.0.1",
        port: proxy.port,
        path: "/fal/download?url=" + encodeURIComponent("http://fal.media/x"),
        method: "GET",
      });
      expect(res.status).toBe(400);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("https://v3.fal.media/files/x.mp4 → allowed host, piped through with upstream content-type", async () => {
      let capturedUrl: string | undefined;
      vi.stubGlobal("fetch", async (url: string) => {
        capturedUrl = url;
        return {
          status: 200,
          headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "video/mp4" : null) },
          body: (async function* () {
            yield new TextEncoder().encode("fake-video-bytes");
          })(),
        };
      });
      const res = await httpRequest({
        host: "127.0.0.1",
        port: proxy.port,
        path: "/fal/download?url=" + encodeURIComponent("https://v3.fal.media/files/x.mp4"),
        method: "GET",
      });
      expect(capturedUrl).toBe("https://v3.fal.media/files/x.mp4");
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe("video/mp4");
      expect(res.headers["content-disposition"]).toBe("attachment");
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
      expect(res.body).toBe("fake-video-bytes");
    });

    it("a redirect to an off-allowlist host → 400 (per-hop SSRF re-validation)", async () => {
      const fetched: string[] = [];
      vi.stubGlobal("fetch", async (url: string) => {
        fetched.push(url);
        return {
          status: 302,
          headers: { get: (k: string) => (k.toLowerCase() === "location" ? "https://169.254.169.254/latest/meta-data" : null) },
          body: null,
        };
      });
      const res = await httpRequest({
        host: "127.0.0.1",
        port: proxy.port,
        path: "/fal/download?url=" + encodeURIComponent("https://v3.fal.media/files/x.mp4"),
        method: "GET",
      });
      expect(res.status).toBe(400);
      expect(fetched).toHaveLength(1); // the redirect target was never fetched
    });

    it("an allowlisted redirect hop is followed; a non-media content-type is neutralized", async () => {
      const fetched: string[] = [];
      vi.stubGlobal("fetch", async (url: string) => {
        fetched.push(url);
        if (fetched.length === 1) {
          return {
            status: 302,
            headers: { get: (k: string) => (k.toLowerCase() === "location" ? "https://cdn.fal.media/real.bin" : null) },
            body: null,
          };
        }
        return {
          status: 200,
          headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "text/html" : null) },
          body: (async function* () {
            yield new TextEncoder().encode("<script>boom</script>");
          })(),
        };
      });
      const res = await httpRequest({
        host: "127.0.0.1",
        port: proxy.port,
        path: "/fal/download?url=" + encodeURIComponent("https://v3.fal.media/files/x.mp4"),
        method: "GET",
      });
      expect(fetched).toEqual(["https://v3.fal.media/files/x.mp4", "https://cdn.fal.media/real.bin"]);
      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toBe("application/octet-stream"); // text/html neutralized
      expect(res.headers["content-disposition"]).toBe("attachment");
      expect(res.body).toBe("<script>boom</script>");
    });
  });

  it("auth gate: bad proxyToken → 401 on /fal/submit (upstream not called)", async () => {
    const gated = await new Promise<{ server: http.Server; port: number }>((resolve) => {
      const server = createProxyServer({
        apiKey: "secret-xyz",
        allowOrigin: TEST_ORIGIN,
        falKey: "fal-secret-key",
        falUpstream: `http://127.0.0.1:${falUpstream.port}`,
        proxyToken: "right-token",
      });
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as { port: number };
        resolve({ server, port: addr.port });
      });
    });
    try {
      const body = JSON.stringify({ modelEndpoint: "fal-ai/veo3/fast", input: {} });
      const res = await httpRequest(
        {
          host: "127.0.0.1",
          port: gated.port,
          path: "/fal/submit",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
            Authorization: "Bearer wrong-token",
          },
        },
        body,
      );
      expect(res.status).toBe(401);
    } finally {
      gated.server.close();
    }
  });
});

describe("createProxyServer — fal routes without falKey configured", () => {
  let proxy: { server: http.Server; port: number };

  beforeAll(async () => {
    proxy = await new Promise((resolve) => {
      const server = createProxyServer({
        apiKey: "secret-xyz",
        allowOrigin: TEST_ORIGIN,
      });
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as { port: number };
        resolve({ server, port: addr.port });
      });
    });
  });

  afterAll(() => {
    proxy.server.close();
  });

  it("GET /fal/enabled → {enabled:false}", async () => {
    const res = await httpRequest({ host: "127.0.0.1", port: proxy.port, path: "/fal/enabled", method: "GET" });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ enabled: false });
  });

  it("POST /fal/submit → 503 {error}", async () => {
    const body = JSON.stringify({ modelEndpoint: "fal-ai/veo3/fast", input: {} });
    const res = await httpRequest(
      {
        host: "127.0.0.1",
        port: proxy.port,
        path: "/fal/submit",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      body,
    );
    expect(res.status).toBe(503);
    expect(JSON.parse(res.body)).toHaveProperty("error");
  });

  it("GET /fal/status → 503", async () => {
    const res = await httpRequest({
      host: "127.0.0.1",
      port: proxy.port,
      path: "/fal/status?model=fal-ai%2Fveo3%2Ffast&job=job-123",
      method: "GET",
    });
    expect(res.status).toBe(503);
  });

  it("GET /fal/download → 503", async () => {
    const res = await httpRequest({
      host: "127.0.0.1",
      port: proxy.port,
      path: "/fal/download?url=" + encodeURIComponent("https://v3.fal.media/files/x.mp4"),
      method: "GET",
    });
    expect(res.status).toBe(503);
  });
});

// ── Trailing-slash base URL normalization ────────────────────────────────────

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
      allowOrigin: TEST_ORIGIN,
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
