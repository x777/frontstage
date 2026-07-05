// fal.ai + OpenRouter pass-through: upstream allowlist, BYO-key header -> Authorization mapping,
// and the route handlers that mirror apps/proxy/src/server.ts's contracts 1:1 (this Worker has no
// runtime dep on that Node app, so URL shapes are re-inlined here — same manual-sync tradeoff
// fal-wire.ts and server.ts already document for FAL_QUEUE_BASE/FAL_REST_BASE).

export const FAL_QUEUE_BASE = "https://queue.fal.run";
export const FAL_REST_BASE = "https://rest.fal.ai";
export const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

// Exact-host allowlist for everywhere WE construct or receive an upstream URL: the fal queue/REST
// hosts, the CDN subdomains fal's signed storage URLs land on, and OpenRouter. This is the only
// allowlist state-changing fal/OpenRouter routes consult — deliberately narrower than
// isAllowedImportHost below, which is a general-host filter for arbitrary user-supplied media URLs.
const ALLOWED_EXACT_HOSTS = new Set(["queue.fal.run", "rest.fal.ai", "openrouter.ai", "fal.ai", "fal.run", "fal.media"]);
const ALLOWED_SUFFIXES = [".fal.ai", ".fal.run", ".fal.media"];

export function isAllowedUpstream(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (ALLOWED_EXACT_HOSTS.has(host)) return true;
  return ALLOWED_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

// General-host counterpart for /import/download's arbitrary media URL (any https origin, not just
// fal's) — ported from apps/proxy/src/server.ts's isAllowedImportHost. Syntax-only pre-filter:
// rejects the URL shapes an attacker would use to reach internal/cloud-metadata services
// (credentials, non-https, localhost, literal IPv4/IPv6). The proxy additionally pins each
// redirect hop to a DNS-resolved address (ssrf-guard.ts) to defeat DNS-rebinding; the Workers
// runtime has no dns.lookup equivalent to do the same, so that extra layer isn't replicated here —
// Workers' fetch also doesn't have a route to the customer's own private network the way a
// self-hosted Node proxy would, which narrows (but doesn't eliminate) that gap.
const IPV4_LITERAL_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

export function isAllowedImportHost(url: URL): boolean {
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (!host) return false;
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  if (IPV4_LITERAL_RE.test(host)) return false;
  if (host.startsWith("[") && host.endsWith("]")) return false; // literal IPv6
  return true;
}

// Path-safety for the fal modelEndpoint and jobId — spliced into the upstream URL, so no ".."
// / leading slash / unexpected characters. Mirrors apps/proxy/src/server.ts exactly.
const MODEL_ENDPOINT_RE = /^[a-zA-Z0-9._/-]+$/;
const JOB_ID_RE = /^[a-zA-Z0-9._-]+$/;

export function isSafeModelEndpoint(modelEndpoint: string): boolean {
  return MODEL_ENDPOINT_RE.test(modelEndpoint) && !modelEndpoint.includes("..") && !modelEndpoint.startsWith("/");
}

export function isSafeJobId(jobId: string): boolean {
  return JOB_ID_RE.test(jobId);
}

// Status/result address the APP — owner/alias, the first two path segments — never the full
// endpoint. Kept in sync with packages/ai/src/generation/fal-wire.ts's falAppId.
export function falAppId(modelEndpoint: string): string {
  return modelEndpoint.split("/").slice(0, 2).join("/");
}

export const UPLOAD_CONTENT_TYPE_RE = /^(audio|image|video)\//;

export type KeyHeaderName = "X-Fal-Key" | "X-OpenRouter-Key";
export type AuthScheme = "Key" | "Bearer";

export interface BuildUpstreamRequestOptions {
  targetUrl: string;
  method: string;
  incomingHeaders: Headers;
  keyHeaderName: KeyHeaderName;
  authScheme: AuthScheme;
  body?: BodyInit | null;
}

export interface UpstreamRequest {
  url: string;
  init: RequestInit;
}

// The ONLY place a user's BYO key is read off the inbound request. It is mapped straight to the
// upstream Authorization header and never copied anywhere else — not logged, not echoed back, not
// forwarded as its original header name. Cookies and any other inbound headers are dropped by
// construction (we build a fresh Headers object here rather than cloning the inbound one).
export function buildUpstreamRequest(opts: BuildUpstreamRequestOptions): UpstreamRequest | { error: string } {
  const key = opts.incomingHeaders.get(opts.keyHeaderName);
  if (!key) return { error: `missing ${opts.keyHeaderName}` };

  const headers = new Headers();
  const contentType = opts.incomingHeaders.get("content-type");
  if (contentType) headers.set("Content-Type", contentType);
  headers.set("Authorization", `${opts.authScheme} ${key}`);

  return { url: opts.targetUrl, init: { method: opts.method, headers, body: opts.body ?? undefined } };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function mediaResponseHeaders(contentType: string | null): Headers {
  const headers = new Headers();
  headers.set("Content-Type", contentType && /^(video|audio|image)\//.test(contentType) ? contentType : "application/octet-stream");
  headers.set("Content-Disposition", "attachment");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
  return headers;
}

export async function handleChatCompletions(request: Request): Promise<Response> {
  const built = buildUpstreamRequest({
    targetUrl: `${OPENROUTER_BASE}/chat/completions`,
    method: "POST",
    incomingHeaders: request.headers,
    keyHeaderName: "X-OpenRouter-Key",
    authScheme: "Bearer",
    body: await request.text(),
  });
  if ("error" in built) return json({ error: built.error }, 401);
  if (!isAllowedUpstream(built.url)) return json({ error: "upstream not allowed" }, 400);

  const headers = built.init.headers as Headers;
  headers.set("Content-Type", "application/json");
  headers.set("HTTP-Referer", "https://frontstage.studio");
  headers.set("X-Title", "Frontstage");

  try {
    const upstreamRes = await fetch(built.url, built.init);
    const responseHeaders = new Headers();
    const ct = upstreamRes.headers.get("content-type");
    if (ct) responseHeaders.set("Content-Type", ct);
    return new Response(upstreamRes.body, { status: upstreamRes.status, headers: responseHeaders });
  } catch {
    return json({ error: "bad gateway" }, 502);
  }
}

export function handleFalEnabled(request: Request): Response {
  return json({ enabled: Boolean(request.headers.get("X-Fal-Key")) });
}

export async function handleFalSubmit(request: Request): Promise<Response> {
  let parsed: { modelEndpoint?: unknown; input?: unknown };
  try {
    parsed = (await request.json()) as { modelEndpoint?: unknown; input?: unknown };
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const modelEndpoint = parsed.modelEndpoint;
  if (typeof modelEndpoint !== "string" || !isSafeModelEndpoint(modelEndpoint)) {
    return json({ error: "invalid modelEndpoint" }, 400);
  }
  const input = parsed.input && typeof parsed.input === "object" ? parsed.input : {};
  const targetUrl = `${FAL_QUEUE_BASE}/${modelEndpoint}`;
  if (!isAllowedUpstream(targetUrl)) return json({ error: "upstream not allowed" }, 400);

  const built = buildUpstreamRequest({
    targetUrl,
    method: "POST",
    incomingHeaders: request.headers,
    keyHeaderName: "X-Fal-Key",
    authScheme: "Key",
    body: JSON.stringify(input),
  });
  if ("error" in built) return json({ error: built.error }, 401);
  (built.init.headers as Headers).set("Content-Type", "application/json");

  try {
    const upstreamRes = await fetch(built.url, built.init);
    const text = await upstreamRes.text();
    return new Response(text, { status: upstreamRes.status, headers: { "Content-Type": "application/json" } });
  } catch {
    return json({ error: "fal upstream error" }, 502);
  }
}

export async function handleFalStatus(request: Request, url: URL): Promise<Response> {
  const model = url.searchParams.get("model");
  const job = url.searchParams.get("job");
  if (!model || !job || !isSafeModelEndpoint(model) || !isSafeJobId(job)) {
    return json({ error: "invalid model or job" }, 400);
  }

  const appId = falAppId(model);
  const statusUrl = `${FAL_QUEUE_BASE}/${appId}/requests/${job}/status`;
  if (!isAllowedUpstream(statusUrl)) return json({ error: "upstream not allowed" }, 400);

  const statusBuilt = buildUpstreamRequest({
    targetUrl: statusUrl,
    method: "GET",
    incomingHeaders: request.headers,
    keyHeaderName: "X-Fal-Key",
    authScheme: "Key",
  });
  if ("error" in statusBuilt) return json({ error: statusBuilt.error }, 401);

  try {
    const statusRes = await fetch(statusBuilt.url, statusBuilt.init);
    const statusJson: unknown = await statusRes.json();
    if (!statusRes.ok) return json({ status: statusJson }, statusRes.status);

    if ((statusJson as { status?: unknown } | null)?.status === "COMPLETED") {
      const resultUrl = `${FAL_QUEUE_BASE}/${appId}/requests/${job}`;
      const resultBuilt = buildUpstreamRequest({
        targetUrl: resultUrl,
        method: "GET",
        incomingHeaders: request.headers,
        keyHeaderName: "X-Fal-Key",
        authScheme: "Key",
      });
      if ("error" in resultBuilt) return json({ error: resultBuilt.error }, 401);
      const resultRes = await fetch(resultBuilt.url, resultBuilt.init);
      const resultJson: unknown = await resultRes.json();
      return json({ status: statusJson, resultJson });
    }

    return json({ status: statusJson });
  } catch {
    return json({ error: "fal upstream error" }, 502);
  }
}

export async function handleFalDownload(url: URL): Promise<Response> {
  const raw = url.searchParams.get("url");
  if (!raw) return json({ error: "missing url" }, 400);

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return json({ error: "invalid url" }, 400);
  }
  if (!isAllowedUpstream(target.toString())) return json({ error: "url host not allowed" }, 400);

  try {
    let upstreamRes = await fetch(target.toString(), { redirect: "manual" });
    for (let hop = 0; hop < 3 && upstreamRes.status >= 300 && upstreamRes.status < 400; hop++) {
      const loc = upstreamRes.headers.get("location");
      if (!loc) break;
      const next = new URL(loc, target);
      if (!isAllowedUpstream(next.toString())) return json({ error: "redirect host not allowed" }, 400);
      target = next;
      upstreamRes = await fetch(target.toString(), { redirect: "manual" });
    }
    if (upstreamRes.status >= 300 && upstreamRes.status < 400) return json({ error: "too many redirects" }, 502);

    const headers = mediaResponseHeaders(upstreamRes.headers.get("content-type"));
    return new Response(upstreamRes.body, { status: upstreamRes.status, headers });
  } catch {
    return json({ error: "fal download error" }, 502);
  }
}

export async function handleFalUpload(request: Request, url: URL): Promise<Response> {
  const contentType = request.headers.get("Content-Type");
  if (!contentType || !UPLOAD_CONTENT_TYPE_RE.test(contentType)) {
    return json({ error: "content-type must be audio/*, image/*, or video/*" }, 400);
  }
  const fileName = url.searchParams.get("filename") || "upload.bin";
  const initiateUrl = `${FAL_REST_BASE}/storage/upload/initiate?storage_type=fal-cdn-v3`;

  const initiateBuilt = buildUpstreamRequest({
    targetUrl: initiateUrl,
    method: "POST",
    incomingHeaders: request.headers,
    keyHeaderName: "X-Fal-Key",
    authScheme: "Key",
    body: JSON.stringify({ content_type: contentType, file_name: fileName }),
  });
  if ("error" in initiateBuilt) return json({ error: initiateBuilt.error }, 401);
  (initiateBuilt.init.headers as Headers).set("Content-Type", "application/json");

  let initJson: { upload_url?: unknown; file_url?: unknown };
  try {
    const initiateRes = await fetch(initiateBuilt.url, initiateBuilt.init);
    if (!initiateRes.ok) return json({ error: "fal upload/initiate error: " + initiateRes.status }, 502);
    initJson = (await initiateRes.json()) as { upload_url?: unknown; file_url?: unknown };
  } catch {
    return json({ error: "fal upload error" }, 502);
  }

  const uploadUrl = typeof initJson.upload_url === "string" ? initJson.upload_url : undefined;
  const fileUrl = typeof initJson.file_url === "string" ? initJson.file_url : undefined;
  if (!uploadUrl || !fileUrl) {
    return json({ error: "fal upload/initiate response missing upload_url/file_url" }, 502);
  }
  if (!isAllowedUpstream(uploadUrl) || !isAllowedUpstream(fileUrl)) {
    return json({ error: "fal upload URL host not allowed" }, 502);
  }

  try {
    // Stream the client's request body straight through as the PUT body — no buffering.
    const putRes = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": contentType }, body: request.body });
    if (!putRes.ok) return json({ error: "fal storage PUT failed: " + putRes.status }, 502);
  } catch {
    return json({ error: "fal upload error" }, 502);
  }

  return json({ url: fileUrl });
}

const IMPORT_MAX_BYTES = 5 * 1024 * 1024 * 1024;

// Counts bytes as they stream through and errors the stream (rather than buffering) if the
// declared-or-actual size exceeds the cap — mirrors apps/proxy/src/server.ts's mid-stream
// enforcement without holding the body in memory.
function capStream(body: ReadableStream<Uint8Array> | null, maxBytes: number): ReadableStream<Uint8Array> | null {
  if (!body) return null;
  let total = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        total += chunk.byteLength;
        if (total > maxBytes) {
          controller.error(new Error("size cap exceeded"));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
}

export async function handleImportDownload(request: Request): Promise<Response> {
  let parsed: { url?: unknown };
  try {
    parsed = (await request.json()) as { url?: unknown };
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  const raw = parsed.url;
  if (typeof raw !== "string" || !raw) return json({ error: "missing url" }, 400);

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return json({ error: "invalid url" }, 400);
  }
  if (!isAllowedImportHost(target)) return json({ error: "url host not allowed" }, 400);

  try {
    let upstreamRes = await fetch(target.toString(), { redirect: "manual" });
    for (let hop = 0; hop < 3 && upstreamRes.status >= 300 && upstreamRes.status < 400; hop++) {
      const loc = upstreamRes.headers.get("location");
      if (!loc) break;
      const next = new URL(loc, target);
      if (!isAllowedImportHost(next)) return json({ error: "redirect host not allowed" }, 400);
      target = next;
      upstreamRes = await fetch(target.toString(), { redirect: "manual" });
    }
    if (upstreamRes.status >= 300 && upstreamRes.status < 400) return json({ error: "too many redirects" }, 502);

    const declaredLength = upstreamRes.headers.get("content-length");
    if (declaredLength && Number(declaredLength) > IMPORT_MAX_BYTES) {
      return json({ error: "remote file exceeds the size cap" }, 413);
    }

    const headers = mediaResponseHeaders(upstreamRes.headers.get("content-type"));
    return new Response(capStream(upstreamRes.body, IMPORT_MAX_BYTES), { status: upstreamRes.status, headers });
  } catch {
    return json({ error: "import download error" }, 502);
  }
}
