import crypto from "node:crypto";
import http from "node:http";

export interface ProxyServerOptions {
  apiKey: string;
  upstreamBaseUrl?: string;
  allowOrigin: string;
  proxyToken?: string;
  falKey?: string;
  falUpstream?: string;
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  };
}

function jsonHeaders(origin: string): Record<string, string> {
  return { "Content-Type": "application/json", ...corsHeaders(origin) };
}

function timingSafeEqual(a: string, b: string): boolean {
  // Always compare same-length buffers to avoid length timing leak.
  const aBytes = Buffer.from(a, "utf-8");
  const bBytes = Buffer.from(b, "utf-8");
  const len = Math.max(aBytes.length, bBytes.length);
  const aPad = Buffer.concat([aBytes, Buffer.alloc(len - aBytes.length)]);
  const bPad = Buffer.concat([bBytes, Buffer.alloc(len - bBytes.length)]);
  return crypto.timingSafeEqual(aPad, bPad) && aBytes.length === bBytes.length;
}

function isAuthorized(req: http.IncomingMessage, proxyToken: string | undefined): boolean {
  if (!proxyToken) return true;
  const inbound = req.headers["authorization"] ?? "";
  return timingSafeEqual(inbound, "Bearer " + proxyToken);
}

function writeUnauthorized(res: http.ServerResponse, origin: string): void {
  res.writeHead(401, { "Content-Type": "text/plain", ...corsHeaders(origin) });
  res.end("Unauthorized");
}

// Path-safety for both the fal modelEndpoint and jobId — they get spliced into the
// upstream URL, so no ".." / leading slash / unexpected characters.
const MODEL_ENDPOINT_RE = /^[a-zA-Z0-9._\/-]+$/;
const JOB_ID_RE = /^[a-zA-Z0-9._-]+$/;

function isSafeModelEndpoint(modelEndpoint: string): boolean {
  return MODEL_ENDPOINT_RE.test(modelEndpoint) && !modelEndpoint.includes("..") && !modelEndpoint.startsWith("/");
}

function isSafeJobId(jobId: string): boolean {
  return JOB_ID_RE.test(jobId);
}

// SSRF guard for /fal/download: only the fal result CDN, over https.
function isAllowedFalDownloadHost(url: URL): boolean {
  if (url.protocol !== "https:") return false;
  const host = url.hostname;
  return host === "fal.media" || host.endsWith(".fal.media") || host.endsWith(".fal.run");
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });
}

export function createProxyServer(opts: ProxyServerOptions): http.Server {
  if (!opts.allowOrigin || opts.allowOrigin === "*") {
    throw new Error("allowOrigin must be a specific origin (not '*')");
  }
  const origin = opts.allowOrigin;
  const upstream = (opts.upstreamBaseUrl ?? "https://openrouter.ai/api/v1").replace(/\/+$/, "");
  const proxyToken = opts.proxyToken;
  const falKey = opts.falKey;
  const falUpstream = (opts.falUpstream ?? "https://queue.fal.run").replace(/\/+$/, "");

  return http.createServer((req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders(origin));
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", "http://localhost");
    const pathname = url.pathname;

    if (req.method === "GET" && pathname === "/healthz") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      return;
    }

    if (req.method === "POST" && pathname === "/v1/chat/completions") {
      if (!isAuthorized(req, proxyToken)) {
        writeUnauthorized(res, origin);
        return;
      }
      void readBody(req).then((body) => forward(body, upstream, opts.apiKey, origin, res));
      return;
    }

    if (req.method === "GET" && pathname === "/fal/enabled") {
      if (!isAuthorized(req, proxyToken)) {
        writeUnauthorized(res, origin);
        return;
      }
      res.writeHead(200, jsonHeaders(origin));
      res.end(JSON.stringify({ enabled: !!falKey }));
      return;
    }

    if (req.method === "POST" && pathname === "/fal/submit") {
      if (!isAuthorized(req, proxyToken)) {
        writeUnauthorized(res, origin);
        return;
      }
      if (!falKey) {
        res.writeHead(503, jsonHeaders(origin));
        res.end(JSON.stringify({ error: "fal not configured" }));
        return;
      }
      void readBody(req).then((body) => handleFalSubmit(body, falUpstream, falKey, origin, res));
      return;
    }

    if (req.method === "GET" && pathname === "/fal/status") {
      if (!isAuthorized(req, proxyToken)) {
        writeUnauthorized(res, origin);
        return;
      }
      if (!falKey) {
        res.writeHead(503, jsonHeaders(origin));
        res.end(JSON.stringify({ error: "fal not configured" }));
        return;
      }
      void handleFalStatus(url.searchParams, falUpstream, falKey, origin, res);
      return;
    }

    if (req.method === "GET" && pathname === "/fal/download") {
      if (!isAuthorized(req, proxyToken)) {
        writeUnauthorized(res, origin);
        return;
      }
      if (!falKey) {
        res.writeHead(503, jsonHeaders(origin));
        res.end(JSON.stringify({ error: "fal not configured" }));
        return;
      }
      void handleFalDownload(url.searchParams, origin, res);
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });
}

async function forward(body: string, upstream: string, apiKey: string, origin: string, res: http.ServerResponse): Promise<void> {
  try {
    const upstreamRes = await fetch(upstream + "/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://palmier.pro",
        "X-Title": "PalmierPro",
      },
      body,
    });

    const responseHeaders: Record<string, string> = {
      "Access-Control-Allow-Origin": origin,
    };

    const ct = upstreamRes.headers.get("content-type");
    if (ct) responseHeaders["Content-Type"] = ct;

    res.writeHead(upstreamRes.status, responseHeaders);

    if (!upstreamRes.body) {
      res.end();
      return;
    }

    for await (const chunk of upstreamRes.body as AsyncIterable<Uint8Array>) {
      res.write(chunk);
    }
    res.end();
  } catch {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain", "Access-Control-Allow-Origin": origin });
    }
    res.end("Bad gateway");
  }
}

async function handleFalSubmit(rawBody: string, falUpstream: string, falKey: string, origin: string, res: http.ServerResponse): Promise<void> {
  let parsed: { modelEndpoint?: unknown; input?: unknown };
  try {
    parsed = JSON.parse(rawBody) as { modelEndpoint?: unknown; input?: unknown };
  } catch {
    res.writeHead(400, jsonHeaders(origin));
    res.end(JSON.stringify({ error: "invalid JSON body" }));
    return;
  }

  const modelEndpoint = parsed.modelEndpoint;
  if (typeof modelEndpoint !== "string" || !isSafeModelEndpoint(modelEndpoint)) {
    res.writeHead(400, jsonHeaders(origin));
    res.end(JSON.stringify({ error: "invalid modelEndpoint" }));
    return;
  }
  const input = parsed.input && typeof parsed.input === "object" ? parsed.input : {};

  try {
    const upstreamRes = await fetch(`${falUpstream}/${modelEndpoint}`, {
      method: "POST",
      headers: { Authorization: `Key ${falKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const text = await upstreamRes.text();
    res.writeHead(upstreamRes.status, jsonHeaders(origin));
    res.end(text);
  } catch {
    res.writeHead(502, jsonHeaders(origin));
    res.end(JSON.stringify({ error: "fal upstream error" }));
  }
}

async function handleFalStatus(params: URLSearchParams, falUpstream: string, falKey: string, origin: string, res: http.ServerResponse): Promise<void> {
  const model = params.get("model");
  const job = params.get("job");
  if (!model || !job || !isSafeModelEndpoint(model) || !isSafeJobId(job)) {
    res.writeHead(400, jsonHeaders(origin));
    res.end(JSON.stringify({ error: "invalid model or job" }));
    return;
  }

  try {
    const statusRes = await fetch(`${falUpstream}/${model}/requests/${job}/status`, {
      headers: { Authorization: `Key ${falKey}` },
    });
    const statusJson: unknown = await statusRes.json();
    if (!statusRes.ok) {
      res.writeHead(statusRes.status, jsonHeaders(origin));
      res.end(JSON.stringify({ status: statusJson }));
      return;
    }

    if ((statusJson as { status?: unknown } | null)?.status === "COMPLETED") {
      const resultRes = await fetch(`${falUpstream}/${model}/requests/${job}`, {
        headers: { Authorization: `Key ${falKey}` },
      });
      const resultJson: unknown = await resultRes.json();
      res.writeHead(200, jsonHeaders(origin));
      res.end(JSON.stringify({ status: statusJson, resultJson }));
      return;
    }

    res.writeHead(200, jsonHeaders(origin));
    res.end(JSON.stringify({ status: statusJson }));
  } catch {
    res.writeHead(502, jsonHeaders(origin));
    res.end(JSON.stringify({ error: "fal upstream error" }));
  }
}

async function handleFalDownload(params: URLSearchParams, origin: string, res: http.ServerResponse): Promise<void> {
  const raw = params.get("url");
  if (!raw) {
    res.writeHead(400, jsonHeaders(origin));
    res.end(JSON.stringify({ error: "missing url" }));
    return;
  }

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    res.writeHead(400, jsonHeaders(origin));
    res.end(JSON.stringify({ error: "invalid url" }));
    return;
  }

  if (!isAllowedFalDownloadHost(target)) {
    res.writeHead(400, jsonHeaders(origin));
    res.end(JSON.stringify({ error: "url host not allowed" }));
    return;
  }

  try {
    // Follow redirects manually so every hop stays on the allowlist (SSRF guard).
    let upstreamRes = await fetch(target.toString(), { redirect: "manual" });
    for (let hop = 0; hop < 3 && upstreamRes.status >= 300 && upstreamRes.status < 400; hop++) {
      const loc = upstreamRes.headers.get("location");
      if (!loc) break;
      const next = new URL(loc, target);
      if (!isAllowedFalDownloadHost(next)) {
        res.writeHead(400, jsonHeaders(origin));
        res.end(JSON.stringify({ error: "redirect host not allowed" }));
        return;
      }
      target = next;
      upstreamRes = await fetch(target.toString(), { redirect: "manual" });
    }
    if (upstreamRes.status >= 300 && upstreamRes.status < 400) {
      res.writeHead(502, jsonHeaders(origin));
      res.end(JSON.stringify({ error: "too many redirects" }));
      return;
    }
    const headers: Record<string, string> = { ...corsHeaders(origin) };
    // Media types only; anything else downloads as opaque bytes. Never render in the proxy's origin.
    const ct = upstreamRes.headers.get("content-type") ?? "";
    headers["Content-Type"] = /^(video|audio|image)\//.test(ct) ? ct : "application/octet-stream";
    headers["Content-Disposition"] = "attachment";
    headers["X-Content-Type-Options"] = "nosniff";
    headers["Content-Security-Policy"] = "default-src 'none'; sandbox";
    res.writeHead(upstreamRes.status, headers);

    if (!upstreamRes.body) {
      res.end();
      return;
    }
    for await (const chunk of upstreamRes.body as AsyncIterable<Uint8Array>) {
      res.write(chunk);
    }
    res.end();
  } catch {
    if (!res.headersSent) {
      res.writeHead(502, jsonHeaders(origin));
    }
    res.end(JSON.stringify({ error: "fal download error" }));
  }
}
