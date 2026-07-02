import { mapFalStatus, extractResultUrls, extractResultError } from "@palmier/ai";
import type { GenJobGateway, JobStatus } from "@palmier/ai";

interface DesktopGenBridge {
  falSubmit(modelEndpoint: string, input: Record<string, unknown>): Promise<{ jobId: string } | { error: string }>;
  falStatus(modelEndpoint: string, jobId: string): Promise<{ status: unknown; resultJson?: unknown } | { error: string }>;
  falDownload(url: string): Promise<{ data: ArrayBuffer } | { error: string }>;
  falUpload(bytes: ArrayBuffer, contentType: string, fileName: string): Promise<{ url: string } | { error: string }>;
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
      // A COMPLETED fal job with no error field is a success even when its payload has no
      // known *_url shape (extractResultUrls) — that shape sniffing only covers downloadable-media
      // results; wizper's transcript-JSON result never matches it. resultJson is always attached
      // so a resultUrls-shaped consumer (GenerationService) still fails per-placeholder on an empty
      // resultUrls, while a resultJson-shaped consumer (TranscriptionService) reads the payload directly.
      const error = extractResultError(res.resultJson);
      if (error) return { status: "failed", errorMessage: error };
      return { status: "succeeded", resultUrls: extractResultUrls(res.resultJson), resultJson: res.resultJson };
    }

    return { status: "failed", errorMessage: "Unknown fal status" };
  }

  async downloadResult(url: string): Promise<Uint8Array> {
    const res = await window.desktopGen.falDownload(url);
    if ("error" in res) throw new Error(res.error);
    return new Uint8Array(res.data);
  }

  async uploadFile(bytes: Uint8Array, contentType: string, fileName: string): Promise<string> {
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const res = await window.desktopGen.falUpload(buffer, contentType, fileName);
    if ("error" in res) throw new Error(res.error);
    return res.url;
  }

  async hasKey(): Promise<boolean> {
    return window.desktopAI.hasKey("fal");
  }
}
