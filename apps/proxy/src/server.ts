import crypto from "node:crypto";
import http from "node:http";

export interface ProxyServerOptions {
  apiKey: string;
  upstreamBaseUrl?: string;
  allowOrigin: string;
  proxyToken?: string;
  falKey?: string;
  falUpstream?: string;
  falRestUpstream?: string;
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

// SSRF guard for the fal storage upload PUT: the signed URL fal hands back must stay on a
// fal-controlled host (queue/rest API domains plus the CDN subdomains they redirect uploads to).
function isAllowedFalUploadHost(url: URL): boolean {
  if (url.protocol !== "https:") return false;
  const host = url.hostname;
  return (
    host === "fal.ai" || host.endsWith(".fal.ai") ||
    host === "fal.run" || host.endsWith(".fal.run") ||
    host === "fal.media" || host.endsWith(".fal.media")
  );
}

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const UPLOAD_CONTENT_TYPE_RE = /^(audio|image|video)\//;

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });
}

// Enforces the cap WHILE buffering (aborts on the chunk that crosses it), not after reading
// the whole body — a client can't force us to hold 50MB+ in memory before we say no.
function readBodyCapped(req: http.IncomingMessage, maxBytes: number): Promise<Buffer | { tooLarge: true }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    req.on("data", (c: Buffer) => {
      if (settled) return;
      total += c.length;
      if (total > maxBytes) {
        settled = true;
        // Stop accumulating (never hold 50MB+ in memory) but leave the socket alone —
        // destroying it here races the 413 response the caller is about to write.
        req.pause();
        resolve({ tooLarge: true });
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
    req.on("error", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
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
  // Storage upload initiate lives on the REST host, not the queue host — see fal-wire.ts FAL_REST_BASE.
  const falRestUpstream = (opts.falRestUpstream ?? "https://rest.fal.ai").replace(/\/+$/, "");

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

    if (req.method === "POST" && pathname === "/fal/upload") {
      if (!isAuthorized(req, proxyToken)) {
        writeUnauthorized(res, origin);
        return;
      }
      if (!falKey) {
        res.writeHead(503, jsonHeaders(origin));
        res.end(JSON.stringify({ error: "fal not configured" }));
        return;
      }
      const contentType = req.headers["content-type"];
      if (typeof contentType !== "string" || !UPLOAD_CONTENT_TYPE_RE.test(contentType)) {
        res.writeHead(400, jsonHeaders(origin));
        res.end(JSON.stringify({ error: "content-type must be audio/*, image/*, or video/*" }));
        return;
      }
      const fileName = url.searchParams.get("filename") || "upload.bin";
      void handleFalUpload(req, contentType, fileName, falRestUpstream, falKey, origin, res);
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

// URL shape mirrors packages/ai/src/generation/fal-wire.ts (falUploadInitiateRequest /
// parseFalUploadInitiate / isAllowedFalHost) — this app has no runtime dep on @palmier/ai, kept
// in sync manually, same as the desktop main-process re-inlining noted there.
async function handleFalUpload(
  req: http.IncomingMessage,
  contentType: string,
  fileName: string,
  falRestUpstream: string,
  falKey: string,
  origin: string,
  res: http.ServerResponse,
): Promise<void> {
  const body = await readBodyCapped(req, MAX_UPLOAD_BYTES);
  if ("tooLarge" in body) {
    // Connection: close — the request body wasn't fully drained, so the socket isn't safe to
    // reuse for the client's next keep-alive request.
    res.writeHead(413, { ...jsonHeaders(origin), Connection: "close" });
    res.end(JSON.stringify({ error: "upload exceeds 50MB limit" }));
    return;
  }

  try {
    const initiateRes = await fetch(`${falRestUpstream}/storage/upload/initiate?storage_type=fal-cdn-v3`, {
      method: "POST",
      headers: { Authorization: `Key ${falKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ content_type: contentType, file_name: fileName }),
    });
    if (!initiateRes.ok) {
      res.writeHead(502, jsonHeaders(origin));
      res.end(JSON.stringify({ error: "fal upload/initiate error: " + initiateRes.status }));
      return;
    }

    const initJson = (await initiateRes.json()) as { upload_url?: unknown; file_url?: unknown };
    const uploadUrl = typeof initJson.upload_url === "string" ? initJson.upload_url : undefined;
    const fileUrl = typeof initJson.file_url === "string" ? initJson.file_url : undefined;
    if (!uploadUrl || !fileUrl) {
      res.writeHead(502, jsonHeaders(origin));
      res.end(JSON.stringify({ error: "fal upload/initiate response missing upload_url/file_url" }));
      return;
    }

    let uploadTarget: URL;
    let fileTarget: URL;
    try {
      uploadTarget = new URL(uploadUrl);
      fileTarget = new URL(fileUrl);
    } catch {
      res.writeHead(502, jsonHeaders(origin));
      res.end(JSON.stringify({ error: "fal upload/initiate returned an invalid URL" }));
      return;
    }
    if (!isAllowedFalUploadHost(uploadTarget) || !isAllowedFalUploadHost(fileTarget)) {
      res.writeHead(502, jsonHeaders(origin));
      res.end(JSON.stringify({ error: "fal upload URL host not allowed" }));
      return;
    }

    const putRes = await fetch(uploadTarget.toString(), {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body,
    });
    if (!putRes.ok) {
      res.writeHead(502, jsonHeaders(origin));
      res.end(JSON.stringify({ error: "fal storage PUT failed: " + putRes.status }));
      return;
    }

    res.writeHead(200, jsonHeaders(origin));
    res.end(JSON.stringify({ url: fileUrl }));
  } catch {
    res.writeHead(502, jsonHeaders(origin));
    res.end(JSON.stringify({ error: "fal upload error" }));
  }
}
