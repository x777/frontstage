import { describe, expect, test } from "vitest";
import { parseCookie, serializeCookie, signSession, verifySession } from "./auth.js";

describe("auth", () => {
  test("JWT sign/verify roundtrip + expiry rejection", async () => {
    const t = await signSession({ id: "gh:123", name: "x", provider: "github" }, "secret", 60);
    expect((await verifySession(t, "secret"))!.id).toBe("gh:123");
    expect(await verifySession(t, "wrong")).toBeNull();
    const expired = await signSession({ id: "a", name: "b", provider: "google" }, "secret", -10);
    expect(await verifySession(expired, "secret")).toBeNull();
  });

  test("verifySession rejects malformed tokens", async () => {
    expect(await verifySession("not-a-jwt", "secret")).toBeNull();
    expect(await verifySession("a.b", "secret")).toBeNull();
    expect(await verifySession("a.b.!!!not-base64url!!!", "secret")).toBeNull();
  });

  test("cookie parse/serialize", () => {
    expect(parseCookie("a=1; fs_session=tok", "fs_session")).toBe("tok");
    expect(parseCookie("a=1", "fs_session")).toBeNull();
    expect(parseCookie(null, "fs_session")).toBeNull();
  });

  test("serializeCookie shapes a Secure HttpOnly SameSite=Lax cookie scoped to /api", () => {
    const cookie = serializeCookie("fs_session", "tok123", {
      path: "/api",
      maxAge: 2592000,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    });
    expect(cookie).toBe("fs_session=tok123; Path=/api; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax");
  });
});
