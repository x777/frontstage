import crypto from "node:crypto";

export function isLocalhostOrigin(origin) {
  if (!origin) return true; // non-browser clients send no Origin
  try {
    const u = new URL(origin);
    return (
      u.hostname === "127.0.0.1" ||
      u.hostname === "localhost" ||
      u.hostname === "[::1]" ||
      u.hostname === "::1"
    );
  } catch {
    return false;
  }
}

export function tokenMatches(authHeader, token) {
  if (typeof authHeader !== "string") return false;
  const m = /^Bearer (.+)$/.exec(authHeader);
  if (!m) return false;
  const a = Buffer.from(m[1]);
  const b = Buffer.from(token);
  if (a.length !== b.length) return false; // length guard before timingSafeEqual to avoid throw
  return crypto.timingSafeEqual(a, b);
}

export function checkAuth(req, token) {
  if (!isLocalhostOrigin(req.headers.origin)) return { ok: false, status: 403 };
  if (!tokenMatches(req.headers.authorization, token)) return { ok: false, status: 401 };
  return { ok: true };
}
