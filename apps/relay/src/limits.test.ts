import { describe, expect, test } from "vitest";
import { checkAndCount, type KVLike } from "./limits.js";

function createMemoryKv(): KVLike {
  const store = new Map<string, string>();
  return {
    async get(key) {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
}

describe("limits", () => {
  test("limit trips at N", async () => {
    const kv = createMemoryKv();
    expect(await checkAndCount(kv, "u", 2)).toBe(true);
    expect(await checkAndCount(kv, "u", 2)).toBe(true);
    expect(await checkAndCount(kv, "u", 2)).toBe(false);
  });

  test("counter is bucketed per user", async () => {
    const kv = createMemoryKv();
    expect(await checkAndCount(kv, "a", 1)).toBe(true);
    expect(await checkAndCount(kv, "b", 1)).toBe(true);
    expect(await checkAndCount(kv, "a", 1)).toBe(false);
    expect(await checkAndCount(kv, "b", 1)).toBe(false);
  });

  test("writes with the expected day-bucketed key and TTL", async () => {
    const calls: Array<{ key: string; value: string; options?: { expirationTtl?: number } }> = [];
    const kv: KVLike = {
      async get() {
        return null;
      },
      async put(key, value, options) {
        calls.push({ key, value, options });
      },
    };
    await checkAndCount(kv, "u:1", 5);
    expect(calls).toHaveLength(1);
    const todayBucket = new Date().toISOString().slice(0, 10);
    expect(calls[0]?.key).toBe(`u:u:1:${todayBucket}`);
    expect(calls[0]?.value).toBe("1");
    expect(calls[0]?.options?.expirationTtl).toBe(172800);
  });
});
