import { describe, expect, test } from "vitest";
import { createAuthNonceGuard } from "../src/main/mcp-auth-nonce.mjs";

// No `electron` dependency (pure in-memory Set), so this loads under plain Node/vitest the same
// way it loads via index.cjs's dynamic import() — mirrors project-registry.test.ts's convention.
// Backs M13B final-review H-2: project:authorizePath requires a valid in-flight nonce, minted only
// per MCP "callTool" forward, so a pickerless authorize can't be reached by arbitrary renderer JS.

describe("createAuthNonceGuard", () => {
  test("mint returns a fresh, non-empty string each call", () => {
    const guard = createAuthNonceGuard();
    const a = guard.mint();
    const b = guard.mint();
    expect(typeof a).toBe("string");
    expect(a.length).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });

  test("consume succeeds for a minted, unconsumed nonce", () => {
    const guard = createAuthNonceGuard();
    const nonce = guard.mint();
    expect(guard.consume(nonce)).toBe(true);
  });

  test("consume is single-use: a second consume of the same nonce fails", () => {
    const guard = createAuthNonceGuard();
    const nonce = guard.mint();
    expect(guard.consume(nonce)).toBe(true);
    expect(guard.consume(nonce)).toBe(false);
  });

  test("consume fails for an unknown nonce", () => {
    const guard = createAuthNonceGuard();
    expect(guard.consume("not-a-real-nonce")).toBe(false);
  });

  test("consume fails for null/undefined/empty", () => {
    const guard = createAuthNonceGuard();
    expect(guard.consume(null)).toBe(false);
    expect(guard.consume(undefined)).toBe(false);
    expect(guard.consume("")).toBe(false);
  });

  test("nonces from different guard instances don't cross-validate", () => {
    const guardA = createAuthNonceGuard();
    const guardB = createAuthNonceGuard();
    const nonce = guardA.mint();
    expect(guardB.consume(nonce)).toBe(false);
  });

  test("release removes a nonce without requiring consume's success semantics", () => {
    const guard = createAuthNonceGuard();
    const nonce = guard.mint();
    expect(guard.size()).toBe(1);
    guard.release(nonce);
    expect(guard.size()).toBe(0);
    expect(guard.consume(nonce)).toBe(false);
  });

  test("release on an unknown/already-consumed nonce is a harmless no-op", () => {
    const guard = createAuthNonceGuard();
    expect(() => guard.release("never-minted")).not.toThrow();
    const nonce = guard.mint();
    guard.consume(nonce);
    expect(() => guard.release(nonce)).not.toThrow();
  });

  test("size reflects only currently-pending (unconsumed, unreleased) nonces", () => {
    const guard = createAuthNonceGuard();
    guard.mint();
    guard.mint();
    expect(guard.size()).toBe(2);
    const third = guard.mint();
    guard.consume(third);
    expect(guard.size()).toBe(2);
  });
});
