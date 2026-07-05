import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRelayOrigin, getUserKeys, setUserKeys, fetchMe, loginUrl, logout } from "../src/relay-config.js";

// vitest.config.ts's default "node" environment has no global localStorage — a minimal in-memory
// shim, stubbed the same way the gateway tests stub fetch (vi.stubGlobal).
function makeLocalStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  } as Storage;
}

describe("relay-config", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeLocalStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  describe("getRelayOrigin", () => {
    it("defaults to same-origin (empty string)", () => {
      vi.stubEnv("VITE_RELAY_ORIGIN", "");
      expect(getRelayOrigin()).toBe("");
    });

    it("honors VITE_RELAY_ORIGIN for local wrangler dev", () => {
      vi.stubEnv("VITE_RELAY_ORIGIN", "http://localhost:8787");
      expect(getRelayOrigin()).toBe("http://localhost:8787");
    });
  });

  describe("getUserKeys / setUserKeys", () => {
    it("returns {} when nothing is stored", () => {
      expect(getUserKeys()).toEqual({});
    });

    it("round-trips falKey and openRouterKey via localStorage under fs.keys", () => {
      setUserKeys({ falKey: "fal-123", openRouterKey: "or-456" });
      expect(getUserKeys()).toEqual({ falKey: "fal-123", openRouterKey: "or-456" });
      expect(JSON.parse(localStorage.getItem("fs.keys")!)).toEqual({ falKey: "fal-123", openRouterKey: "or-456" });
    });

    it("merges onto existing keys rather than clobbering them", () => {
      setUserKeys({ falKey: "fal-1" });
      setUserKeys({ openRouterKey: "or-1" });
      expect(getUserKeys()).toEqual({ falKey: "fal-1", openRouterKey: "or-1" });
    });

    it("a later save overwrites just the field it touches", () => {
      setUserKeys({ falKey: "fal-1", openRouterKey: "or-1" });
      setUserKeys({ falKey: "fal-2" });
      expect(getUserKeys()).toEqual({ falKey: "fal-2", openRouterKey: "or-1" });
    });

    it("returns {} when the stored value is corrupt JSON", () => {
      localStorage.setItem("fs.keys", "{not json");
      expect(getUserKeys()).toEqual({});
    });
  });

  describe("fetchMe", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("returns the user on a 200 with a user payload", async () => {
      vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => ({ user: { id: "google:1", name: "Ada", provider: "google" } }) }));
      const user = await fetchMe();
      expect(user).toEqual({ id: "google:1", name: "Ada", provider: "google" });
    });

    it("returns null on a 401", async () => {
      vi.stubGlobal("fetch", async () => ({ ok: false, status: 401, json: async () => ({ error: "unauthorized" }) }));
      expect(await fetchMe()).toBeNull();
    });

    it("returns null when the network request throws", async () => {
      vi.stubGlobal("fetch", async () => { throw new Error("offline"); });
      expect(await fetchMe()).toBeNull();
    });

    it("sends credentials: include", async () => {
      let capturedInit: RequestInit | undefined;
      vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
        capturedInit = init;
        return { ok: true, json: async () => ({ user: null }) };
      });
      await fetchMe();
      expect(capturedInit?.credentials).toBe("include");
    });
  });

  describe("loginUrl", () => {
    it("builds the google authorize URL under the relay origin's /api", () => {
      vi.stubEnv("VITE_RELAY_ORIGIN", "");
      expect(loginUrl("google")).toBe("/api/auth/google");
    });

    it("builds the github authorize URL", () => {
      vi.stubEnv("VITE_RELAY_ORIGIN", "");
      expect(loginUrl("github")).toBe("/api/auth/github");
    });

    it("prefixes a configured relay origin", () => {
      vi.stubEnv("VITE_RELAY_ORIGIN", "http://localhost:8787");
      expect(loginUrl("google")).toBe("http://localhost:8787/api/auth/google");
    });
  });

  describe("logout", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("POSTs to /api/auth/logout with credentials: include", async () => {
      let capturedUrl: string | undefined;
      let capturedInit: RequestInit | undefined;
      vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
        capturedUrl = url;
        capturedInit = init;
        return { ok: true, status: 204 };
      });
      await logout();
      expect(capturedUrl).toBe("/api/auth/logout");
      expect(capturedInit?.method).toBe("POST");
      expect(capturedInit?.credentials).toBe("include");
    });

    it("does not throw when the network request fails", async () => {
      vi.stubGlobal("fetch", async () => { throw new Error("offline"); });
      await expect(logout()).resolves.toBeUndefined();
    });
  });
});
