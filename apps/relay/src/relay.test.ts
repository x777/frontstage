import { describe, expect, test } from "vitest";
import { buildUpstreamRequest, isAllowedImportHost, isAllowedUpstream } from "./relay.js";

describe("relay", () => {
  test("upstream allowlist", () => {
    expect(isAllowedUpstream("https://queue.fal.run/fal-ai/veo3/requests/1/status")).toBe(true);
    expect(isAllowedUpstream("https://rest.fal.ai/storage/upload")).toBe(true);
    expect(isAllowedUpstream("https://evil.com/x")).toBe(false);
    expect(isAllowedUpstream("http://169.254.169.254/meta")).toBe(false);
  });

  test("upstream allowlist covers fal CDN subdomains and openrouter", () => {
    expect(isAllowedUpstream("https://v3.fal.media/files/abc.mp4")).toBe(true);
    expect(isAllowedUpstream("https://openrouter.ai/api/v1/chat/completions")).toBe(true);
    expect(isAllowedUpstream("https://fal.run.evil.com/x")).toBe(false);
    expect(isAllowedUpstream("http://queue.fal.run/x")).toBe(false); // https only
  });

  test("import-download host filter rejects private/loopback/localhost-shaped hosts", () => {
    expect(isAllowedImportHost(new URL("https://example.com/video.mp4"))).toBe(true);
    expect(isAllowedImportHost(new URL("http://example.com/video.mp4"))).toBe(false);
    expect(isAllowedImportHost(new URL("https://localhost/video.mp4"))).toBe(false);
    expect(isAllowedImportHost(new URL("https://127.0.0.1/video.mp4"))).toBe(false);
    expect(isAllowedImportHost(new URL("https://169.254.169.254/meta"))).toBe(false);
    expect(isAllowedImportHost(new URL("https://user:pass@example.com/x"))).toBe(false);
  });

  test("key header maps to upstream Authorization and is not echoed", () => {
    const incomingHeaders = new Headers({ "X-Fal-Key": "secret123", Cookie: "fs_session=abc" });
    const built = buildUpstreamRequest({
      targetUrl: "https://queue.fal.run/fal-ai/veo3",
      method: "POST",
      incomingHeaders,
      keyHeaderName: "X-Fal-Key",
      authScheme: "Key",
      body: "{}",
    });

    expect("error" in built).toBe(false);
    if ("error" in built) return;
    const headers = built.init.headers as Headers;
    expect(headers.get("Authorization")).toBe("Key secret123");
    expect(headers.get("Cookie")).toBeNull();
    expect(headers.get("X-Fal-Key")).toBeNull();
    for (const [name, value] of headers.entries()) {
      if (name.toLowerCase() === "authorization") continue;
      expect(value).not.toContain("secret123");
    }
  });

  test("openrouter key maps with Bearer scheme", () => {
    const built = buildUpstreamRequest({
      targetUrl: "https://openrouter.ai/api/v1/chat/completions",
      method: "POST",
      incomingHeaders: new Headers({ "X-OpenRouter-Key": "or-secret" }),
      keyHeaderName: "X-OpenRouter-Key",
      authScheme: "Bearer",
    });
    expect("error" in built).toBe(false);
    if ("error" in built) return;
    expect((built.init.headers as Headers).get("Authorization")).toBe("Bearer or-secret");
  });

  test("missing key header yields an error, not a pass-through request", () => {
    const built = buildUpstreamRequest({
      targetUrl: "https://queue.fal.run/x",
      method: "GET",
      incomingHeaders: new Headers(),
      keyHeaderName: "X-Fal-Key",
      authScheme: "Key",
    });
    expect(built).toEqual({ error: "missing X-Fal-Key" });
  });
});
