import crypto from "node:crypto";

export function isLocalhostOrigin(origin) {
  if (!origin) return true; // non-browser clients send no Origin; the token is the gate
  try {
    const u = new URL(origin);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    return u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "[::1]" || u.hostname === "::1";
  } catch { return false; }
}

export function isLocalhostHost(host) {
  // host may be "127.0.0.1:19789" / "localhost:19789" / "127.0.0.1" / "[::1]:19789"
  if (typeof host !== "string" || host.length === 0) return false;
  // strip the port (last colon, but keep IPv6 brackets)
  const h = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
  return h === "127.0.0.1" || h === "localhost" || h === "[::1]" || h === "::1";
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
  if (!isLocalhostHost(req.headers.host)) return { ok: false, status: 403 };
  if (!isLocalhostOrigin(req.headers.origin)) return { ok: false, status: 403 };
  if (!tokenMatches(req.headers.authorization, token)) return { ok: false, status: 401 };
  return { ok: true };
}
