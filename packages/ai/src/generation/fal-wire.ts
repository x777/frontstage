// Pure fal.ai queue wire shaping — no fetch. Single isolation point for the fal contract.
// Verified against docs.fal.ai (queue API) 2026-07: submit POST /{model_id}, status GET
// /{model_id}/requests/{request_id}/status, result GET /{model_id}/requests/{request_id}.
export const FAL_QUEUE_BASE = "https://queue.fal.run";

export function falSubmitRequest(modelEndpoint: string, input: Record<string, unknown>): { url: string; body: string } {
  return { url: `${FAL_QUEUE_BASE}/${modelEndpoint}`, body: JSON.stringify(input) };
}

// Status/result address the APP — owner/alias, the first two path segments — never the full
// endpoint (fal-js queue.ts does the same). Nested routes 405 otherwise (live-hit: seedance,
// elevenlabs). Submit alone takes the full path.
export function falAppId(modelEndpoint: string): string {
  return modelEndpoint.split("/").slice(0, 2).join("/");
}

export function falStatusRequest(modelEndpoint: string, jobId: string): { url: string } {
  return { url: `${FAL_QUEUE_BASE}/${falAppId(modelEndpoint)}/requests/${jobId}/status` };
}

export function falResultRequest(modelEndpoint: string, jobId: string): { url: string } {
  return { url: `${FAL_QUEUE_BASE}/${falAppId(modelEndpoint)}/requests/${jobId}` };
}

export function parseFalSubmit(json: unknown): { jobId: string } | { error: string } {
  const id = (json as Record<string, unknown> | null)?.["request_id"];
  if (typeof id === "string" && id.length > 0) return { jobId: id };
  return { error: "fal submit response missing request_id" };
}

export function mapFalStatus(json: unknown): "queued" | "running" | "completed" | "unknown" {
  const status = (json as Record<string, unknown> | null)?.["status"];
  if (status === "IN_QUEUE") return "queued";
  if (status === "IN_PROGRESS") return "running";
  if (status === "COMPLETED") return "completed";
  return "unknown";
}

function urlOf(value: unknown): string | undefined {
  const url = (value as Record<string, unknown> | null)?.["url"];
  return typeof url === "string" ? url : undefined;
}

export function extractResultUrls(json: unknown): string[] {
  if (json === null || typeof json !== "object") return [];
  const obj = json as Record<string, unknown>;

  const video = urlOf(obj["video"]);
  if (video !== undefined) return [video];

  const images = obj["images"];
  if (Array.isArray(images)) {
    const urls = images.map(urlOf).filter((u): u is string => u !== undefined);
    if (urls.length > 0) return urls;
  }

  const audio = urlOf(obj["audio"]);
  if (audio !== undefined) return [audio];

  const audioFile = urlOf(obj["audio_file"]);
  if (audioFile !== undefined) return [audioFile];

  const topLevel = obj["url"];
  if (typeof topLevel === "string") return [topLevel];

  return [];
}

export function extractResultError(json: unknown): string | undefined {
  if (json === null || typeof json !== "object") return undefined;
  const obj = json as Record<string, unknown>;
  for (const key of ["error", "detail", "message"] as const) {
    const val = obj[key];
    if (typeof val === "string" && val.length > 0) return val;
  }
  return undefined;
}

// Storage upload contract — verified 2026-07 against the official @fal-ai/client (fal-js) source
// (github.com/fal-ai/fal-js, libs/client/src/storage.ts + config.ts): initiate is
// POST {FAL_REST_BASE}/storage/upload/initiate?storage_type=fal-cdn-v3, Authorization: Key <falKey>,
// body {content_type, file_name} -> {upload_url, file_url}; then PUT upload_url with the raw
// bytes + a Content-Type header, no auth (it's a signed URL). The usable URL is file_url.
// DEVIATION: an earlier draft of this plan assumed rest.fal.run — fal-js's actual default REST
// host is rest.fal.ai. Kept as a constant (not hardcoded inline) so a future host change stays
// a one-file fix; callers that can't import ESM (desktop main, the proxy) re-inline this and
// must be kept in sync, same as FAL_QUEUE_BASE above.
export const FAL_REST_BASE = "https://rest.fal.ai";

export function falUploadInitiateRequest(contentType: string, fileName: string): { url: string; body: string } {
  return {
    url: `${FAL_REST_BASE}/storage/upload/initiate?storage_type=fal-cdn-v3`,
    body: JSON.stringify({ content_type: contentType, file_name: fileName }),
  };
}

export function parseFalUploadInitiate(json: unknown): { uploadUrl: string; fileUrl: string } | { error: string } {
  const obj = json as Record<string, unknown> | null;
  const uploadUrl = obj?.["upload_url"];
  const fileUrl = obj?.["file_url"];
  if (typeof uploadUrl === "string" && uploadUrl.length > 0 && typeof fileUrl === "string" && fileUrl.length > 0) {
    return { uploadUrl, fileUrl };
  }
  return { error: "fal upload/initiate response missing upload_url/file_url" };
}

// SSRF allowlist for fal-controlled hosts: the REST/queue APIs and the signed storage URLs
// they hand back (which land on a CDN subdomain, e.g. v3.fal.media).
export function isAllowedFalHost(url: URL): boolean {
  if (url.protocol !== "https:") return false;
  const host = url.hostname;
  return (
    host === "fal.ai" || host.endsWith(".fal.ai") ||
    host === "fal.run" || host.endsWith(".fal.run") ||
    host === "fal.media" || host.endsWith(".fal.media")
  );
}
