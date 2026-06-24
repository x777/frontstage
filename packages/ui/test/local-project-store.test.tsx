import { localProjectStore } from "../src/storage/local-project-store.js";

beforeEach(() => {
  localStorage.clear();
});

test("localProjectStore: writeText/readText round-trip via localStorage", async () => {
  const s1 = localProjectStore("ns");
  await s1.writeText("a.json", "hello");

  // Simulate reload: a fresh store instance reads the same localStorage
  const s2 = localProjectStore("ns");
  expect(await s2.readText("a.json")).toBe("hello");
});

test("localProjectStore: missing key returns null", async () => {
  const s = localProjectStore("ns");
  expect(await s.readText("missing.json")).toBeNull();
});

test("localProjectStore: namespacing — ns1 and ns2 don't collide", async () => {
  const s1 = localProjectStore("ns1");
  const s2 = localProjectStore("ns2");
  await s1.writeText("key.json", "from-ns1");
  await s2.writeText("key.json", "from-ns2");

  expect(await s1.readText("key.json")).toBe("from-ns1");
  expect(await s2.readText("key.json")).toBe("from-ns2");
});

test("localProjectStore: fallback Map when localStorage throws", async () => {
  // Simulate localStorage being unavailable by replacing it temporarily
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    get() { throw new Error("localStorage not available"); },
    configurable: true,
  });

  const s = localProjectStore("fallback-ns");
  // Should not throw; uses in-memory Map
  await expect(s.writeText("x.json", "val")).resolves.toBeUndefined();
  expect(await s.readText("x.json")).toBe("val");

  // Restore
  if (original) Object.defineProperty(globalThis, "localStorage", original);
});
