import crypto from "node:crypto";
import http from "node:http";
import { Agent } from "undici";
import { checkHostResolution, type ResolvedAddress } from "./ssrf-guard.js";

export interface ProxyServerOptions {
  apiKey: string;
  upstreamBaseUrl?: string;
  allowOrigin: string;
  proxyToken?: string;
  falKey?: string;
  falUpstream?: string;
  falRestUpstream?: string;
  // Override for /import/download's byte cap — test-only escape hatch so the mid-stream
  // (as opposed to pre-flight Content-Length) enforcement path can be exercised without
  // actually allocating gigabytes of fake body. Defaults to IMPORT_MAX_BYTES (5GB).
  importMaxBytes?: number;
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

// SSRF guard for /import/download: general-host (any https origin, not just fal's), so instead of
// an allowlist this denies the shapes an attacker would use to reach internal/cloud-metadata
// services — credentials, non-https, "localhost", and any literal IP host (v4 or v6, public or
// private). This is a fast syntax-only pre-filter; it does NOT by itself stop DNS-rebinding (an
// ordinary-looking hostname whose DNS record points at a private/metadata IP) — that's handled by
// validateImportTarget below, which resolves the hostname and re-checks the resolved address(es)
// against ssrf-guard's isPrivateAddress on every request AND every redirect hop.
const IPV4_LITERAL_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

function isAllowedImportHost(url: URL): boolean {
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (!host) return false;
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  if (IPV4_LITERAL_RE.test(host)) return false;
  if (host.startsWith("[") && host.endsWith("]")) return false; // literal IPv6
  return true;
}

const IMPORT_MAX_BYTES = 5 * 1024 * 1024 * 1024;
const IMPORT_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_IMPORT_REQUEST_BODY = 8 * 1024;

type ImportTargetValidation = { ok: true; pinnedAddress: ResolvedAddress } | { ok: false };

// Syntax check + DNS resolution + private-address rejection, run before the initial fetch and
// again on every redirect hop. Returns the resolved address to pin the connection to (closes the
// TOCTOU window between "we checked this hostname" and "the socket actually connects" — see
// createPinnedDispatcher).
async function validateImportTarget(url: URL): Promise<ImportTargetValidation> {
  if (!isAllowedImportHost(url)) return { ok: false };
  const resolution = await checkHostResolution(url.hostname);
  if (!resolution.ok) return { ok: false };
  const pinnedAddress = resolution.addresses[0];
  if (!pinnedAddress) return { ok: false };
  return { ok: true, pinnedAddress };
}

// Pins the connection to the exact address we just validated instead of trusting a second,
// independent DNS lookup at connect time — undici's connector calls this in place of a real
// lookup, so the hostname is resolved exactly once, by us, and the validated result is what's
// actually dialed (no window for the name to re-resolve to something else in between).
function createPinnedDispatcher(pinned: ResolvedAddress): Agent {
  return new Agent({
    connect: {
      lookup: (_hostname, _options, callback) => {
        callback(null, [{ address: pinned.address, family: pinned.family }]);
      },
    },
  });
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
  const importMaxBytes = opts.importMaxBytes ?? IMPORT_MAX_BYTES;

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

    if (req.method === "POST" && pathname === "/import/download") {
      if (!isAuthorized(req, proxyToken)) {
        writeUnauthorized(res, origin);
        return;
      }
      void readBodyCapped(req, MAX_IMPORT_REQUEST_BODY).then((body) => {
        if ("tooLarge" in body) {
          res.writeHead(413, { ...jsonHeaders(origin), Connection: "close" });
          res.end(JSON.stringify({ error: "request body too large" }));
          return;
        }
        return handleImportDownload(body.toString("utf-8"), origin, res, importMaxBytes);
      });
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
        "HTTP-Referer": "https://frontstage.studio",
        "X-Title": "Frontstage",
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

  // Status/result address owner/alias (first two segments), never the full endpoint — nested
  // routes 405 otherwise. Kept in sync with fal-wire.ts falAppId.
  const appId = model.split("/").slice(0, 2).join("/");
  try {
    const statusRes = await fetch(`${falUpstream}/${appId}/requests/${job}/status`, {
      headers: { Authorization: `Key ${falKey}` },
    });
    const statusJson: unknown = await statusRes.json();
    if (!statusRes.ok) {
      res.writeHead(statusRes.status, jsonHeaders(origin));
      res.end(JSON.stringify({ status: statusJson }));
      return;
    }

    if ((statusJson as { status?: unknown } | null)?.status === "COMPLETED") {
      const resultRes = await fetch(`${falUpstream}/${appId}/requests/${job}`, {
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

// General-host counterpart to handleFalDownload, for import_media's url source (M12A T3): same
// per-hop SSRF re-validation + media-type neutralization treatment, plus a size cap and a request
// timeout since the target isn't a trusted CDN and files can be up to 5GB. Every hop is resolved
// and pinned via validateImportTarget/createPinnedDispatcher (ssrf-guard.ts) rather than trusted by
// hostname alone — see that module's comment for why.
async function handleImportDownload(rawBody: string, origin: string, res: http.ServerResponse, importMaxBytes: number): Promise<void> {
  let parsed: { url?: unknown };
  try {
    parsed = JSON.parse(rawBody) as { url?: unknown };
  } catch {
    res.writeHead(400, jsonHeaders(origin));
    res.end(JSON.stringify({ error: "invalid JSON body" }));
    return;
  }

  const raw = parsed.url;
  if (typeof raw !== "string" || !raw) {
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

  const initialValidation = await validateImportTarget(target);
  if (!initialValidation.ok) {
    res.writeHead(400, jsonHeaders(origin));
    res.end(JSON.stringify({ error: "url host not allowed" }));
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMPORT_TIMEOUT_MS);
  let dispatcher = createPinnedDispatcher(initialValidation.pinnedAddress);
  try {
    // Follow redirects manually so every hop is re-resolved, re-validated, and re-pinned.
    let upstreamRes = await fetch(target.toString(), { redirect: "manual", signal: controller.signal, dispatcher });
    for (let hop = 0; hop < 3 && upstreamRes.status >= 300 && upstreamRes.status < 400; hop++) {
      const loc = upstreamRes.headers.get("location");
      if (!loc) break;
      const next = new URL(loc, target);
      const hopValidation = await validateImportTarget(next);
      if (!hopValidation.ok) {
        res.writeHead(400, jsonHeaders(origin));
        res.end(JSON.stringify({ error: "redirect host not allowed" }));
        return;
      }
      target = next;
      const prevDispatcher = dispatcher;
      dispatcher = createPinnedDispatcher(hopValidation.pinnedAddress);
      void prevDispatcher.close();
      upstreamRes = await fetch(target.toString(), { redirect: "manual", signal: controller.signal, dispatcher });
    }
    if (upstreamRes.status >= 300 && upstreamRes.status < 400) {
      res.writeHead(502, jsonHeaders(origin));
      res.end(JSON.stringify({ error: "too many redirects" }));
      return;
    }

    const declaredLength = upstreamRes.headers.get("content-length");
    if (declaredLength && Number(declaredLength) > importMaxBytes) {
      res.writeHead(413, jsonHeaders(origin));
      res.end(JSON.stringify({ error: "remote file exceeds the size cap" }));
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
    let total = 0;
    for await (const chunk of upstreamRes.body as AsyncIterable<Uint8Array>) {
      total += chunk.length;
      if (total > importMaxBytes) {
        // Headers are already committed at this point — cut the connection rather than send a
        // clean error body (no Content-Length promise to keep, and no way to un-send a 200).
        res.destroy();
        return;
      }
      res.write(chunk);
    }
    res.end();
  } catch {
    if (!res.headersSent) {
      res.writeHead(502, jsonHeaders(origin));
      res.end(JSON.stringify({ error: "import download error" }));
      return;
    }
    res.end();
  } finally {
    clearTimeout(timer);
    void dispatcher.close();
  }
}

// URL shape mirrors packages/ai/src/generation/fal-wire.ts (falUploadInitiateRequest /
// parseFalUploadInitiate / isAllowedFalHost) — this app has no runtime dep on @frontstage/ai, kept
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
