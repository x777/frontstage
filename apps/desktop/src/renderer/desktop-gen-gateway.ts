import { mapFalStatus, extractResultUrls, extractResultError } from "@palmier/ai";
import type { GenJobGateway, JobStatus } from "@palmier/ai";

interface DesktopGenBridge {
  falSubmit(modelEndpoint: string, input: Record<string, unknown>): Promise<{ jobId: string } | { error: string }>;
  falStatus(modelEndpoint: string, jobId: string): Promise<{ status: unknown; resultJson?: unknown } | { error: string }>;
  falDownload(url: string): Promise<{ data: ArrayBuffer } | { error: string }>;
}

declare global {
  interface Window {
    desktopGen: DesktopGenBridge;
  }
}

export class DesktopGenGateway implements GenJobGateway {
  async submitJob(modelEndpoint: string, input: Record<string, unknown>): Promise<{ jobId: string }> {
    const res = await window.desktopGen.falSubmit(modelEndpoint, input);
    if ("error" in res) throw new Error(res.error);
    return res;
  }

  async jobStatus(modelEndpoint: string, jobId: string): Promise<JobStatus> {
    const res = await window.desktopGen.falStatus(modelEndpoint, jobId);
    if ("error" in res) throw new Error(res.error);

    const mapped = mapFalStatus(res.status);
    if (mapped === "queued" || mapped === "running") return { status: mapped };

    if (mapped === "completed") {
      const urls = extractResultUrls(res.resultJson);
      if (urls.length > 0) return { status: "succeeded", resultUrls: urls };
      return { status: "failed", errorMessage: extractResultError(res.resultJson) ?? "Generation failed" };
    }

    return { status: "failed", errorMessage: "Unknown fal status" };
  }

  async downloadResult(url: string): Promise<Uint8Array> {
    const res = await window.desktopGen.falDownload(url);
    if ("error" in res) throw new Error(res.error);
    return new Uint8Array(res.data);
  }

  async hasKey(): Promise<boolean> {
    return window.desktopAI.hasKey("fal");
  }
}
