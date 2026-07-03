import dns from "node:dns";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkHostResolution, isPrivateAddress } from "../src/ssrf-guard.js";

describe("isPrivateAddress — IPv4", () => {
  it.each([
    ["0.0.0.0", true, "0.0.0.0/8"],
    ["0.255.255.255", true, "0.0.0.0/8 upper bound"],
    ["127.0.0.1", true, "loopback"],
    ["127.255.255.255", true, "loopback upper bound"],
    ["10.0.0.0", true, "10.0.0.0/8"],
    ["10.255.255.255", true, "10.0.0.0/8 upper bound"],
    ["172.15.255.255", false, "just below 172.16.0.0/12 — allowed"],
    ["172.16.0.0", true, "172.16.0.0/12 lower bound — denied"],
    ["172.31.255.255", true, "172.16.0.0/12 upper bound — denied"],
    ["172.32.0.0", false, "just above 172.16.0.0/12 — allowed"],
    ["192.168.0.0", true, "192.168.0.0/16"],
    ["192.168.255.255", true, "192.168.0.0/16 upper bound"],
    ["192.167.255.255", false, "just below 192.168.0.0/16 — allowed"],
    ["169.254.0.0", true, "169.254.0.0/16 (link-local / cloud metadata)"],
    ["169.254.169.254", true, "cloud metadata endpoint"],
    ["169.254.255.255", true, "169.254.0.0/16 upper bound"],
    ["100.63.255.255", false, "just below 100.64.0.0/10 (CGNAT) — allowed"],
    ["100.64.0.0", true, "100.64.0.0/10 (CGNAT) lower bound — denied"],
    ["100.127.255.255", true, "100.64.0.0/10 (CGNAT) upper bound — denied"],
    ["100.128.0.0", false, "just above 100.64.0.0/10 — allowed"],
    ["8.8.8.8", false, "public DNS"],
    ["93.184.216.34", false, "public host"],
    ["1.1.1.1", false, "public DNS"],
  ])("%s → private=%s (%s)", (ip, expected) => {
    expect(isPrivateAddress(ip)).toBe(expected);
  });
});

describe("isPrivateAddress — IPv6", () => {
  it.each([
    ["::1", true, "loopback"],
    ["::", true, "unspecified"],
    ["0:0:0:0:0:0:0:1", true, "loopback, uncompressed form"],
    ["fc00::", true, "fc00::/7 (unique local) lower bound"],
    ["fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff", true, "fc00::/7 upper bound"],
    ["fe80::", true, "fe80::/10 (link-local) lower bound"],
    ["fe80::1", true, "link-local address"],
    ["febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff", true, "fe80::/10 upper bound"],
    ["fec0::", false, "just above fe80::/10 — allowed (deprecated site-local, not in scope)"],
    ["2001:db8::1", false, "public documentation range"],
    ["2606:4700:4700::1111", false, "public (Cloudflare DNS)"],
  ])("%s → private=%s (%s)", (ip, expected) => {
    expect(isPrivateAddress(ip)).toBe(expected);
  });
});

describe("isPrivateAddress — IPv4-mapped IPv6 (::ffff:a.b.c.d)", () => {
  it.each([
    ["::ffff:127.0.0.1", true, "mapped loopback"],
    ["::ffff:10.0.0.1", true, "mapped private 10.x"],
    ["::ffff:172.16.5.5", true, "mapped private 172.16.x"],
    ["::ffff:172.32.5.5", false, "mapped public (just above 172.16.0.0/12)"],
    ["::ffff:192.168.1.1", true, "mapped private 192.168.x"],
    ["::ffff:169.254.169.254", true, "mapped cloud metadata"],
    ["::ffff:8.8.8.8", false, "mapped public"],
  ])("%s → private=%s (%s)", (ip, expected) => {
    expect(isPrivateAddress(ip)).toBe(expected);
  });
});

describe("isPrivateAddress — malformed input fails closed", () => {
  it.each([
    ["not-an-ip", true],
    ["999.999.999.999", true],
    ["1.2.3", true],
    ["", true],
    [":::", true],
  ])("%s → private=%s (fail closed)", (ip, expected) => {
    expect(isPrivateAddress(ip)).toBe(expected);
  });
});

describe("checkHostResolution", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves to only public addresses → ok: true", async () => {
    vi.spyOn(dns.promises, "lookup").mockImplementation(
      (() => Promise.resolve([{ address: "93.184.216.34", family: 4 }])) as unknown as typeof dns.promises.lookup,
    );
    const result = await checkHostResolution("cdn.example.com");
    expect(result.ok).toBe(true);
  });

  it("resolves to a private address → ok: false", async () => {
    vi.spyOn(dns.promises, "lookup").mockImplementation(
      (() => Promise.resolve([{ address: "10.0.0.1", family: 4 }])) as unknown as typeof dns.promises.lookup,
    );
    const result = await checkHostResolution("evil.example.com");
    expect(result.ok).toBe(false);
  });

  it("resolves to multiple addresses, one private → ok: false (rejects if ANY is private)", async () => {
    vi.spyOn(dns.promises, "lookup").mockImplementation(
      (() =>
        Promise.resolve([
          { address: "93.184.216.34", family: 4 },
          { address: "127.0.0.1", family: 4 },
        ])) as unknown as typeof dns.promises.lookup,
    );
    const result = await checkHostResolution("multi.example.com");
    expect(result.ok).toBe(false);
  });

  it("DNS lookup throws → ok: false (fails closed, not open)", async () => {
    vi.spyOn(dns.promises, "lookup").mockImplementation(
      (() => Promise.reject(new Error("getaddrinfo ENOTFOUND"))) as unknown as typeof dns.promises.lookup,
    );
    const result = await checkHostResolution("does-not-resolve.example.com");
    expect(result.ok).toBe(false);
  });
});
