import { mapFalStatus, extractResultUrls, extractResultError } from "@palmier/ai";
import type { GenJobGateway, JobStatus } from "@palmier/ai";

export class WebGenGateway implements GenJobGateway {
  constructor(private proxyUrl: string, private proxyToken?: string) {}

  private headers(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { ...extra };
    if (this.proxyToken) headers["Authorization"] = "Bearer " + this.proxyToken;
    return headers;
  }

  async submitJob(modelEndpoint: string, input: Record<string, unknown>): Promise<{ jobId: string }> {
    const res = await fetch(this.proxyUrl + "/fal/submit", {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ modelEndpoint, input }),
    });
    const json = (await res.json()) as { jobId?: string; error?: string };
    if (!res.ok || json.error) throw new Error(json.error ?? "fal proxy error: " + res.status);
    if (typeof json.jobId !== "string") throw new Error("fal proxy error: missing jobId");
    return { jobId: json.jobId };
  }

  async jobStatus(modelEndpoint: string, jobId: string): Promise<JobStatus> {
    const url = `${this.proxyUrl}/fal/status?model=${encodeURIComponent(modelEndpoint)}&job=${encodeURIComponent(jobId)}`;
    const res = await fetch(url, { headers: this.headers() });
    const json = (await res.json()) as { status?: unknown; resultJson?: unknown; error?: string };
    if (!res.ok || json.error) throw new Error(json.error ?? "fal proxy error: " + res.status);

    const mapped = mapFalStatus(json.status);
    if (mapped === "queued") return { status: "queued" };
    if (mapped === "running") return { status: "running" };
    if (mapped === "completed") {
      const urls = extractResultUrls(json.resultJson);
      const error = extractResultError(json.resultJson);
      if (urls.length > 0 && !error) return { status: "succeeded", resultUrls: urls };
      return { status: "failed", errorMessage: error ?? "fal job completed with no result" };
    }
    return { status: "failed", errorMessage: "unknown fal job status" };
  }

  async downloadResult(url: string): Promise<Uint8Array> {
    const res = await fetch(this.proxyUrl + "/fal/download?url=" + encodeURIComponent(url), { headers: this.headers() });
    if (!res.ok) throw new Error("fal proxy error: " + res.status);
    return new Uint8Array(await res.arrayBuffer());
  }

  async uploadFile(bytes: Uint8Array, contentType: string, fileName: string): Promise<string> {
    const url = this.proxyUrl + "/fal/upload?filename=" + encodeURIComponent(fileName);
    const res = await fetch(url, {
      method: "POST",
      headers: this.headers({ "Content-Type": contentType }),
      body: bytes as BodyInit,
    });
    const json = (await res.json()) as { url?: string; error?: string };
    if (!res.ok || json.error) throw new Error(json.error ?? "fal proxy error: " + res.status);
    if (typeof json.url !== "string") throw new Error("fal proxy error: missing url");
    return json.url;
  }

  async hasKey(): Promise<boolean> {
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
