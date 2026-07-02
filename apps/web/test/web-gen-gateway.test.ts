import { afterEach, describe, expect, it, vi } from "vitest";
import { WebGenGateway } from "../src/web-gen-gateway.js";

describe("WebGenGateway", () => {
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(handler: (url: string, init: RequestInit) => { ok: boolean; status: number; json?: () => Promise<unknown>; arrayBuffer?: () => Promise<ArrayBuffer> }) {
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedInit = init;
      return handler(url, init);
    });
  }

  describe("submitJob", () => {
    it("POSTs to /fal/submit with the proxy token and body", async () => {
      stubFetch(() => ({ ok: true, status: 200, json: async () => ({ jobId: "job-1" }) }));
      const gw = new WebGenGateway("http://localhost:8787", "my-tok");
      const result = await gw.submitJob("fal-ai/veo3/fast", { prompt: "a cat" });

      expect(result).toEqual({ jobId: "job-1" });
      expect(capturedUrl).toBe("http://localhost:8787/fal/submit");
      expect((capturedInit as { method: string }).method).toBe("POST");
      const headers = capturedInit?.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer my-tok");
      expect(headers["Content-Type"]).toBe("application/json");
      expect(JSON.parse(capturedInit?.body as string)).toEqual({ modelEndpoint: "fal-ai/veo3/fast", input: { prompt: "a cat" } });
    });

    it("rejects when the response is not ok", async () => {
      stubFetch(() => ({ ok: false, status: 503, json: async () => ({ error: "fal not configured" }) }));
      const gw = new WebGenGateway("http://localhost:8787");
      await expect(gw.submitJob("fal-ai/veo3/fast", {})).rejects.toThrow();
    });

    it("rejects when the response body carries an error field", async () => {
      stubFetch(() => ({ ok: true, status: 200, json: async () => ({ error: "bad model" }) }));
      const gw = new WebGenGateway("http://localhost:8787");
      await expect(gw.submitJob("fal-ai/veo3/fast", {})).rejects.toThrow(/bad model/);
    });

    it("without a proxyToken — no Authorization header sent", async () => {
      stubFetch(() => ({ ok: true, status: 200, json: async () => ({ jobId: "job-1" }) }));
      const gw = new WebGenGateway("http://localhost:8787");
      await gw.submitJob("fal-ai/veo3/fast", {});
      const headers = capturedInit?.headers as Record<string, string>;
      expect(headers["Authorization"]).toBeUndefined();
    });
  });

  describe("jobStatus", () => {
    it("maps a running status", async () => {
      stubFetch(() => ({ ok: true, status: 200, json: async () => ({ status: { status: "IN_PROGRESS" } }) }));
      const gw = new WebGenGateway("http://localhost:8787", "my-tok");
      const status = await gw.jobStatus("fal-ai/veo3/fast", "job-1");
      expect(status.status).toBe("running");
      expect(capturedUrl).toBe("http://localhost:8787/fal/status?model=fal-ai%2Fveo3%2Ffast&job=job-1");
    });

    it("maps completed + result urls to succeeded", async () => {
      stubFetch(() => ({
        ok: true,
        status: 200,
        json: async () => ({ status: { status: "COMPLETED" }, resultJson: { video: { url: "https://v3.fal.media/files/x.mp4" } } }),
      }));
      const gw = new WebGenGateway("http://localhost:8787");
      const status = await gw.jobStatus("fal-ai/veo3/fast", "job-1");
      expect(status.status).toBe("succeeded");
      expect(status.resultUrls).toEqual(["https://v3.fal.media/files/x.mp4"]);
    });

    it("maps completed without urls to succeeded with empty resultUrls (e.g. wizper's transcript JSON has no *_url shape)", async () => {
      stubFetch(() => ({
        ok: true,
        status: 200,
        json: async () => ({ status: { status: "COMPLETED" }, resultJson: { text: "hello" } }),
      }));
      const gw = new WebGenGateway("http://localhost:8787");
      const status = await gw.jobStatus("fal-ai/veo3/fast", "job-1");
      expect(status.status).toBe("succeeded");
      expect(status.resultUrls).toEqual([]);
      expect(status.resultJson).toEqual({ text: "hello" });
    });

    it("always attaches resultJson on a succeeded status, even when urls are present", async () => {
      stubFetch(() => ({
        ok: true,
        status: 200,
        json: async () => ({ status: { status: "COMPLETED" }, resultJson: { video: { url: "https://v3.fal.media/files/x.mp4" } } }),
      }));
      const gw = new WebGenGateway("http://localhost:8787");
      const status = await gw.jobStatus("fal-ai/veo3/fast", "job-1");
      expect(status.status).toBe("succeeded");
      expect(status.resultUrls).toEqual(["https://v3.fal.media/files/x.mp4"]);
      expect(status.resultJson).toEqual({ video: { url: "https://v3.fal.media/files/x.mp4" } });
    });

    it("maps completed with an error field to failed + errorMessage", async () => {
      stubFetch(() => ({
        ok: true,
        status: 200,
        json: async () => ({ status: { status: "COMPLETED" }, resultJson: { error: "model exploded" } }),
      }));
      const gw = new WebGenGateway("http://localhost:8787");
      const status = await gw.jobStatus("fal-ai/veo3/fast", "job-1");
      expect(status.status).toBe("failed");
      expect(status.errorMessage).toBe("model exploded");
    });
  });

  describe("downloadResult", () => {
    it("GETs /fal/download and returns bytes", async () => {
      const bytes = new Uint8Array([1, 2, 3, 4]);
      stubFetch(() => ({ ok: true, status: 200, arrayBuffer: async () => bytes.buffer }));
      const gw = new WebGenGateway("http://localhost:8787", "my-tok");
      const result = await gw.downloadResult("https://v3.fal.media/files/x.mp4");
      expect(result).toEqual(bytes);
      expect(capturedUrl).toBe("http://localhost:8787/fal/download?url=" + encodeURIComponent("https://v3.fal.media/files/x.mp4"));
      const headers = capturedInit?.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("Bearer my-tok");
    });

    it("rejects when the response is not ok", async () => {
      stubFetch(() => ({ ok: false, status: 400 }));
      const gw = new WebGenGateway("http://localhost:8787");
      await expect(gw.downloadResult("https://evil.com/x")).rejects.toThrow();
    });
  });

  describe("uploadFile", () => {
    it("POSTs raw bytes to /fal/upload?filename=... with Content-Type + proxy token", async () => {
      stubFetch(() => ({ ok: true, status: 200, json: async () => ({ url: "https://v3.fal.media/files/x.png" }) }));
      const gw = new WebGenGateway("http://localhost:8787", "my-tok");
      const bytes = new Uint8Array([1, 2, 3]);
      const url = await gw.uploadFile(bytes, "image/png", "a.png");

      expect(url).toBe("https://v3.fal.media/files/x.png");
      expect(capturedUrl).toBe("http://localhost:8787/fal/upload?filename=a.png");
      expect((capturedInit as { method: string }).method).toBe("POST");
      const headers = capturedInit?.headers as Record<string, string>;
      expect(headers["Content-Type"]).toBe("image/png");
      expect(headers["Authorization"]).toBe("Bearer my-tok");
      expect(capturedInit?.body).toBe(bytes);
    });

    it("rejects when the response carries an error field", async () => {
      stubFetch(() => ({ ok: true, status: 200, json: async () => ({ error: "too large" }) }));
      const gw = new WebGenGateway("http://localhost:8787");
      await expect(gw.uploadFile(new Uint8Array([1]), "image/png", "a.png")).rejects.toThrow(/too large/);
    });

    it("rejects when the response is not ok", async () => {
      stubFetch(() => ({ ok: false, status: 413, json: async () => ({ error: "upload exceeds 50MB limit" }) }));
      const gw = new WebGenGateway("http://localhost:8787");
      await expect(gw.uploadFile(new Uint8Array([1]), "image/png", "a.png")).rejects.toThrow(/50MB/);
    });
  });

  describe("hasKey", () => {
    it("returns true when the proxy reports fal enabled", async () => {
      stubFetch(() => ({ ok: true, status: 200, json: async () => ({ enabled: true }) }));
      const gw = new WebGenGateway("http://localhost:8787");
      expect(await gw.hasKey()).toBe(true);
      expect(capturedUrl).toBe("http://localhost:8787/fal/enabled");
    });

    it("returns false when the proxy reports fal disabled", async () => {
      stubFetch(() => ({ ok: true, status: 200, json: async () => ({ enabled: false }) }));
      const gw = new WebGenGateway("http://localhost:8787");
      expect(await gw.hasKey()).toBe(false);
    });
  });
});
