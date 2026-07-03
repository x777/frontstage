import dns from "node:dns";
import http from "node:http";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Agent } from "undici";
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

function httpRequest(options: http.RequestOptions, body?: string | Buffer): Promise<{ status: number; headers: http.IncomingMessage["headers"]; body: string }> {
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

  describe("POST /fal/upload", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it("happy path: initiates on the REST host with Key auth, PUTs bytes to the signed URL, returns {url}", async () => {
      const bytes = Buffer.from([1, 2, 3, 4, 5]);
      const calls: { url: string; init: { method?: string; headers?: Record<string, string>; body?: unknown } }[] = [];
      vi.stubGlobal("fetch", async (url: string, init: { method?: string; headers?: Record<string, string>; body?: unknown }) => {
        calls.push({ url, init });
        if (url === "https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3") {
          return {
            ok: true,
            status: 200,
            json: async () => ({ upload_url: "https://v3.fal.media/upload/xyz", file_url: "https://v3.fal.media/files/xyz" }),
          };
        }
        if (url === "https://v3.fal.media/upload/xyz") {
          return { ok: true, status: 200 };
        }
        throw new Error("unexpected fetch url: " + url);
      });

      const res = await httpRequest(
        {
          host: "127.0.0.1",
          port: proxy.port,
          path: "/fal/upload?filename=a.png",
          method: "POST",
          headers: { "Content-Type": "image/png", "Content-Length": bytes.length },
        },
        bytes,
      );

      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ url: "https://v3.fal.media/files/xyz" });

      const initiateCall = calls.find((c) => c.url.startsWith("https://rest.fal.ai/storage/upload/initiate"));
      expect(initiateCall?.init.headers?.["Authorization"]).toBe("Key fal-secret-key");
      expect(JSON.parse(initiateCall!.init.body as string)).toEqual({ content_type: "image/png", file_name: "a.png" });

      const putCall = calls.find((c) => c.url === "https://v3.fal.media/upload/xyz");
      expect(putCall?.init.method).toBe("PUT");
      expect(putCall?.init.headers?.["Content-Type"]).toBe("image/png");
      expect(Buffer.from(putCall!.init.body as Buffer)).toEqual(bytes);
    });

    it("over the 50MB cap → 413, upstream never called (enforced while buffering)", async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      const bytes = Buffer.alloc(50 * 1024 * 1024 + 1024, 1);

      const res = await httpRequest(
        {
          host: "127.0.0.1",
          port: proxy.port,
          path: "/fal/upload?filename=big.png",
          method: "POST",
          headers: { "Content-Type": "image/png", "Content-Length": bytes.length },
        },
        bytes,
      );

      expect(res.status).toBe(413);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("bad content-type → 400, upstream never called", async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);

      const res = await httpRequest(
        {
          host: "127.0.0.1",
          port: proxy.port,
          path: "/fal/upload?filename=a.txt",
          method: "POST",
          headers: { "Content-Type": "text/plain", "Content-Length": 3 },
        },
        Buffer.from("abc"),
      );

      expect(res.status).toBe(400);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("initiate returns an off-allowlist signed URL → refused, PUT never attempted", async () => {
      const calls: string[] = [];
      vi.stubGlobal("fetch", async (url: string) => {
        calls.push(url);
        if (url.startsWith("https://rest.fal.ai/storage/upload/initiate")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ upload_url: "https://evil.com/steal", file_url: "https://evil.com/files/x" }),
          };
        }
        throw new Error("unexpected fetch: " + url);
      });

      const res = await httpRequest(
        {
          host: "127.0.0.1",
          port: proxy.port,
          path: "/fal/upload?filename=a.png",
          method: "POST",
          headers: { "Content-Type": "image/png", "Content-Length": 3 },
        },
        Buffer.from([1, 2, 3]),
      );

      expect(res.status).toBe(502);
      expect(calls).toHaveLength(1); // the off-allowlist URL was never fetched
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

  it("auth gate: bad proxyToken → 401 on /fal/upload (upstream not called)", async () => {
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
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const res = await httpRequest(
        {
          host: "127.0.0.1",
          port: gated.port,
          path: "/fal/upload?filename=a.png",
          method: "POST",
          headers: { "Content-Type": "image/png", "Content-Length": 3, Authorization: "Bearer wrong-token" },
        },
        Buffer.from([1, 2, 3]),
      );
      expect(res.status).toBe(401);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
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

  it("POST /fal/upload → 503", async () => {
    const res = await httpRequest(
      {
        host: "127.0.0.1",
        port: proxy.port,
        path: "/fal/upload?filename=a.png",
        method: "POST",
        headers: { "Content-Type": "image/png", "Content-Length": 3 },
      },
      Buffer.from([1, 2, 3]),
    );
    expect(res.status).toBe(503);
  });
});

// ── POST /import/download — SSRF guard (general host, M12A T3) ──────────────

describe("createProxyServer — POST /import/download", () => {
  let proxy: { server: http.Server; port: number };

  beforeAll(async () => {
    proxy = await startProxy(0);
  });

  afterAll(() => {
    proxy.server.close();
  });

  beforeEach(() => {
    // Hermetic DNS: test hostnames aren't real, so stub dns.promises.lookup instead of hitting
    // the network. Default resolves any hostname to a public IP; individual tests override this
    // (via mockImplementationOnce/mockResolvedValueOnce) to exercise the DNS-rebinding guard.
    vi.spyOn(dns.promises, "lookup").mockImplementation(
      (() => Promise.resolve([{ address: "93.184.216.34", family: 4 }])) as unknown as typeof dns.promises.lookup,
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function postImport(url: string): Promise<{ status: number; headers: http.IncomingMessage["headers"]; body: string }> {
    const body = JSON.stringify({ url });
    return httpRequest(
      {
        host: "127.0.0.1",
        port: proxy.port,
        path: "/import/download",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
      },
      body,
    );
  }

  const deniedHosts = [
    ["a public literal IPv4 host", "https://8.8.8.8/x"],
    ["localhost", "https://localhost/x"],
    ["a .localhost host", "https://foo.localhost/x"],
    ["loopback 127.x", "https://127.0.0.1/x"],
    ["private 10.x", "https://10.1.2.3/x"],
    ["private 172.16-31.x (172.16.0.1)", "https://172.16.0.1/x"],
    ["private 172.16-31.x (172.31.255.255)", "https://172.31.255.255/x"],
    ["private 192.168.x", "https://192.168.1.1/x"],
    ["link-local 169.254.x (cloud metadata)", "https://169.254.169.254/latest/meta-data"],
    ["literal IPv6 [::1]", "https://[::1]/x"],
  ] as const;

  for (const [label, url] of deniedHosts) {
    it(`${label} → 400, no upstream fetch attempted`, async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      const res = await postImport(url);
      expect(res.status).toBe(400);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  }

  it("http (not https) → 400, no upstream fetch attempted", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await postImport("http://example.com/x.mp4");
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("embedded credentials → 400, no upstream fetch attempted", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await postImport("https://user:pass@example.com/x.mp4");
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("missing url → 400", async () => {
    const res = await httpRequest(
      {
        host: "127.0.0.1",
        port: proxy.port,
        path: "/import/download",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": 2 },
      },
      "{}",
    );
    expect(res.status).toBe(400);
  });

  it("invalid JSON body → 400", async () => {
    const res = await httpRequest(
      {
        host: "127.0.0.1",
        port: proxy.port,
        path: "/import/download",
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": 5 },
      },
      "not json",
    );
    expect(res.status).toBe(400);
  });

  it("happy path: allowed https host is fetched, media content-type piped through", async () => {
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
    const res = await postImport("https://cdn.example.com/clip.mp4");
    expect(capturedUrl).toBe("https://cdn.example.com/clip.mp4");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("video/mp4");
    expect(res.headers["content-disposition"]).toBe("attachment");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.body).toBe("fake-video-bytes");
  });

  it("a non-media content-type is neutralized to application/octet-stream", async () => {
    vi.stubGlobal("fetch", async () => ({
      status: 200,
      headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "text/html" : null) },
      body: (async function* () {
        yield new TextEncoder().encode("<script>boom</script>");
      })(),
    }));
    const res = await postImport("https://cdn.example.com/clip.mp4");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/octet-stream");
  });

  it("a redirect to a denied host → 400 (per-hop SSRF re-validation), target never fetched", async () => {
    const fetched: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      fetched.push(url);
      return {
        status: 302,
        headers: { get: (k: string) => (k.toLowerCase() === "location" ? "https://169.254.169.254/latest/meta-data" : null) },
        body: null,
      };
    });
    const res = await postImport("https://cdn.example.com/clip.mp4");
    expect(res.status).toBe(400);
    expect(fetched).toHaveLength(1); // the redirect target was never fetched
  });

  it("an allowed redirect hop is followed", async () => {
    const fetched: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      fetched.push(url);
      if (fetched.length === 1) {
        return {
          status: 302,
          headers: { get: (k: string) => (k.toLowerCase() === "location" ? "https://cdn2.example.com/real.mp4" : null) },
          body: null,
        };
      }
      return {
        status: 200,
        headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "video/mp4" : null) },
        body: (async function* () {
          yield new TextEncoder().encode("real-bytes");
        })(),
      };
    });
    const res = await postImport("https://cdn.example.com/clip.mp4");
    expect(fetched).toEqual(["https://cdn.example.com/clip.mp4", "https://cdn2.example.com/real.mp4"]);
    expect(res.status).toBe(200);
    expect(res.body).toBe("real-bytes");
  });

  it("more than 3 redirect hops → 502", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls++;
      return {
        status: 302,
        headers: { get: (k: string) => (k.toLowerCase() === "location" ? "https://cdn.example.com/next" : null) },
        body: null,
      };
    });
    const res = await postImport("https://cdn.example.com/clip.mp4");
    expect(res.status).toBe(502);
    expect(calls).toBe(4); // initial + 3 hops, then gives up
  });

  it("oversize (Content-Length over the cap) → 413, no bytes streamed", async () => {
    const overCap = 5 * 1024 * 1024 * 1024 + 1;
    vi.stubGlobal("fetch", async () => ({
      status: 200,
      headers: {
        get: (k: string) => {
          const kl = k.toLowerCase();
          if (kl === "content-length") return String(overCap);
          if (kl === "content-type") return "video/mp4";
          return null;
        },
      },
      body: (async function* () {
        yield new TextEncoder().encode("should never be read");
      })(),
    }));
    const res = await postImport("https://cdn.example.com/huge.mp4");
    expect(res.status).toBe(413);
  });

  it("oversize mid-stream (no/false Content-Length, body exceeds the cap while streaming) → aborted, no full body sent", async () => {
    // A tiny cap makes this test fast without allocating gigabytes of fake body; the proxy
    // supports a test-only importMaxBytes override for exactly this (see ProxyServerOptions).
    const smallCapProxy = await startProxy(0, { importMaxBytes: 10 });
    try {
      vi.stubGlobal("fetch", async () => ({
        status: 200,
        headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "video/mp4" : null) }, // no content-length
        body: (async function* () {
          yield new TextEncoder().encode("0123456789"); // exactly at the cap, still allowed
          yield new TextEncoder().encode("more-bytes-that-cross-the-cap");
          yield new TextEncoder().encode("this-chunk-must-never-be-observed");
        })(),
      }));
      const body = JSON.stringify({ url: "https://cdn.example.com/huge.mp4" });
      // Headers are already committed (200) before the cap is crossed mid-stream, so the proxy
      // cuts the connection (res.destroy()) instead of a clean error response — plain httpRequest
      // would reject on the resulting "socket hang up", so collect what arrived before that here.
      const result = await new Promise<{ status: number; chunks: string; endedCleanly: boolean }>((resolve, reject) => {
        const req = http.request(
          {
            host: "127.0.0.1",
            port: smallCapProxy.port,
            path: "/import/download",
            method: "POST",
            headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
          },
          (res) => {
            let chunks = "";
            res.on("data", (c: Buffer) => { chunks += c.toString("utf-8"); });
            res.on("end", () => resolve({ status: res.statusCode ?? 0, chunks, endedCleanly: true }));
            res.on("error", () => resolve({ status: res.statusCode ?? 0, chunks, endedCleanly: false }));
          },
        );
        req.on("error", () => resolve({ status: 0, chunks: "", endedCleanly: false }));
        req.write(body);
        req.end();
      });
      expect(result.chunks).not.toContain("this-chunk-must-never-be-observed");
      // Either the socket was cut mid-stream (endedCleanly: false) or the client happened to see
      // the connection close right at the cap — either way, the over-cap chunk must never appear.
      expect(result.chunks.length).toBeLessThan("0123456789more-bytes-that-cross-the-cap".length);
    } finally {
      smallCapProxy.server.close();
    }
  });

  describe("DNS-rebinding SSRF guard", () => {
    it("hostname resolves to a private/metadata IP → 400, no upstream fetch attempted", async () => {
      vi.spyOn(dns.promises, "lookup").mockImplementation(
        (() => Promise.resolve([{ address: "169.254.169.254", family: 4 }])) as unknown as typeof dns.promises.lookup,
      );
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      const res = await postImport("https://evil-rebind.example.com/x");
      expect(res.status).toBe(400);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("hostname resolves to a mix of public + private addresses → 400 (rejects if ANY address is private)", async () => {
      vi.spyOn(dns.promises, "lookup").mockImplementation(
        (() =>
          Promise.resolve([
            { address: "93.184.216.34", family: 4 },
            { address: "10.0.0.5", family: 4 },
          ])) as unknown as typeof dns.promises.lookup,
      );
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      const res = await postImport("https://multi-a-record.example.com/x");
      expect(res.status).toBe(400);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("hostname resolves to an IPv4-mapped-IPv6 private address (::ffff:10.0.0.1) → 400", async () => {
      vi.spyOn(dns.promises, "lookup").mockImplementation(
        (() => Promise.resolve([{ address: "::ffff:10.0.0.1", family: 6 }])) as unknown as typeof dns.promises.lookup,
      );
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      const res = await postImport("https://mapped-rebind.example.com/x");
      expect(res.status).toBe(400);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("a redirect hop that resolves to a private IP via DNS → 400, redirect target never fetched", async () => {
      vi.spyOn(dns.promises, "lookup").mockImplementation(((hostname: string) => {
        if (hostname === "evil-hop.example.com") return Promise.resolve([{ address: "127.0.0.1", family: 4 }]);
        return Promise.resolve([{ address: "93.184.216.34", family: 4 }]);
      }) as unknown as typeof dns.promises.lookup);
      const fetched: string[] = [];
      vi.stubGlobal("fetch", async (url: string) => {
        fetched.push(url);
        return {
          status: 302,
          headers: { get: (k: string) => (k.toLowerCase() === "location" ? "https://evil-hop.example.com/x" : null) },
          body: null,
        };
      });
      const res = await postImport("https://cdn.example.com/clip.mp4");
      expect(res.status).toBe(400);
      expect(fetched).toHaveLength(1); // the DNS-rebinding redirect target was never fetched
    });

    it("DNS resolution failure (ENOTFOUND) → 400, fails closed rather than open", async () => {
      vi.spyOn(dns.promises, "lookup").mockImplementation(
        (() => Promise.reject(Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }))) as unknown as typeof dns.promises.lookup,
      );
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);
      const res = await postImport("https://does-not-resolve.example.com/x");
      expect(res.status).toBe(400);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("connection pinning: the validated address is passed to fetch via an undici dispatcher", async () => {
      let capturedInit: { dispatcher?: unknown } | undefined;
      vi.stubGlobal("fetch", async (_url: string, init: { dispatcher?: unknown }) => {
        capturedInit = init;
        return {
          status: 200,
          headers: { get: (k: string) => (k.toLowerCase() === "content-type" ? "video/mp4" : null) },
          body: (async function* () {
            yield new TextEncoder().encode("bytes");
          })(),
        };
      });
      const res = await postImport("https://cdn.example.com/clip.mp4");
      expect(res.status).toBe(200);
      expect(capturedInit?.dispatcher).toBeInstanceOf(Agent);
    });
  });
});

describe("createProxyServer — POST /import/download — proxyToken auth", () => {
  it("bad proxyToken → 401, upstream not called", async () => {
    const gated = await startProxy(0, { proxyToken: "right-token" });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const body = JSON.stringify({ url: "https://cdn.example.com/clip.mp4" });
      const res = await httpRequest(
        {
          host: "127.0.0.1",
          port: gated.port,
          path: "/import/download",
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
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      gated.server.close();
    }
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
