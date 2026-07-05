import { mapFalStatus, extractResultUrls, extractResultError } from "@frontstage/ai";
import type { GenJobGateway, JobStatus } from "@frontstage/ai";
import type { UserKeys } from "./relay-config.js";

// Relay mode config (M18C T2) — mirrors WebAiGateway's: base = relayOrigin + "/api", the user's
// fal.ai key rides a header instead of a proxy bearer token, session cookie carried along.
export interface RelayGatewayConfig {
  origin: string;
  getKeys: () => UserKeys;
}

export class WebGenGateway implements GenJobGateway {
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

  private headers(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { ...extra };
    if (this.mode === "relay") {
      const key = this.getKeys!().falKey;
      if (key) headers["X-Fal-Key"] = key;
    } else if (this.proxyToken) {
      headers["Authorization"] = "Bearer " + this.proxyToken;
    }
    return headers;
  }

  private requestInit(init: RequestInit): RequestInit {
    return this.mode === "relay" ? { ...init, credentials: "include" } : init;
  }

  async submitJob(modelEndpoint: string, input: Record<string, unknown>): Promise<{ jobId: string }> {
    const res = await fetch(
      this.base() + "/fal/submit",
      this.requestInit({
        method: "POST",
        headers: this.headers({ "Content-Type": "application/json" }),
        body: JSON.stringify({ modelEndpoint, input }),
      }),
    );
    const json = (await res.json()) as { jobId?: string; error?: string };
    if (!res.ok || json.error) throw new Error(json.error ?? "fal proxy error: " + res.status);
    if (typeof json.jobId !== "string") throw new Error("fal proxy error: missing jobId");
    return { jobId: json.jobId };
  }

  async jobStatus(modelEndpoint: string, jobId: string): Promise<JobStatus> {
    const url = `${this.base()}/fal/status?model=${encodeURIComponent(modelEndpoint)}&job=${encodeURIComponent(jobId)}`;
    const res = await fetch(url, this.requestInit({ headers: this.headers() }));
    const json = (await res.json()) as { status?: unknown; resultJson?: unknown; error?: string };
    if (!res.ok || json.error) throw new Error(json.error ?? "fal proxy error: " + res.status);

    const mapped = mapFalStatus(json.status);
    if (mapped === "queued") return { status: "queued" };
    if (mapped === "running") return { status: "running" };
    if (mapped === "completed") {
      // A COMPLETED fal job with no error field is a success even when its payload has no
      // known *_url shape (extractResultUrls) — that shape sniffing only covers downloadable-media
      // results; wizper's transcript-JSON result never matches it. resultJson is always attached
      // so a resultUrls-shaped consumer (GenerationService) still fails per-placeholder on an empty
      // resultUrls, while a resultJson-shaped consumer (TranscriptionService) reads the payload directly.
      const error = extractResultError(json.resultJson);
      if (error) return { status: "failed", errorMessage: error };
      return { status: "succeeded", resultUrls: extractResultUrls(json.resultJson), resultJson: json.resultJson };
    }
    return { status: "failed", errorMessage: "unknown fal job status" };
  }

  async downloadResult(url: string): Promise<Uint8Array> {
    const res = await fetch(this.base() + "/fal/download?url=" + encodeURIComponent(url), this.requestInit({ headers: this.headers() }));
    if (!res.ok) throw new Error("fal proxy error: " + res.status);
    return new Uint8Array(await res.arrayBuffer());
  }

  async uploadFile(bytes: Uint8Array, contentType: string, fileName: string): Promise<string> {
    const url = this.base() + "/fal/upload?filename=" + encodeURIComponent(fileName);
    const res = await fetch(
      url,
      this.requestInit({ method: "POST", headers: this.headers({ "Content-Type": contentType }), body: bytes as BodyInit }),
    );
    const json = (await res.json()) as { url?: string; error?: string };
    if (!res.ok || json.error) throw new Error(json.error ?? "fal proxy error: " + res.status);
    if (typeof json.url !== "string") throw new Error("fal proxy error: missing url");
    return json.url;
  }

  async hasKey(): Promise<boolean> {
    // Relay mode: local truth — no server round trip needed to know whether the browser holds a key.
    if (this.mode === "relay") return Boolean(this.getKeys!().falKey);
    try {
      const res = await fetch(this.proxyUrl + "/fal/enabled", { headers: this.headers() });
      if (!res.ok) return false;
      const json = (await res.json()) as { enabled?: boolean };
      return json.enabled === true;
    } catch {
      return false; // unreachable proxy = no key
    }
  }
}
