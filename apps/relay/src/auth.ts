// Session JWT (HS256, hand-rolled via Web Crypto — no jsonwebtoken/jose dep needed for one
// algorithm) + cookie parsing + OAuth authorize/exchange for Google and GitHub. All Web Crypto
// APIs used here (crypto.subtle, atob/btoa, TextEncoder) exist in both the Workers runtime and
// Node 18+, so the pure parts are testable under plain vitest — no miniflare required.

export interface SessionPayload {
  id: string;
  name: string;
  provider: string;
}

interface SessionClaims extends SessionPayload {
  exp: number;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

export async function signSession(payload: SessionPayload, secret: string, expiresInSeconds: number): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const claims: SessionClaims = { ...payload, exp: Math.floor(Date.now() / 1000) + expiresInSeconds };
  const encHeader = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const encPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(claims)));
  const signingInput = `${encHeader}.${encPayload}`;
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64UrlEncode(new Uint8Array(sig))}`;
}

export async function verifySession(token: string, secret: string): Promise<SessionPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [encHeader, encPayload, encSig] = parts as [string, string, string];
  const key = await importHmacKey(secret);

  let sigBytes: Uint8Array;
  try {
    sigBytes = base64UrlDecode(encSig);
  } catch {
    return null;
  }
  const valid = await crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(`${encHeader}.${encPayload}`));
  if (!valid) return null;

  let claims: SessionClaims;
  try {
    claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(encPayload))) as SessionClaims;
  } catch {
    return null;
  }
  if (typeof claims.exp !== "number" || claims.exp < Math.floor(Date.now() / 1000)) return null;
  if (typeof claims.id !== "string" || typeof claims.name !== "string" || typeof claims.provider !== "string") return null;
  return { id: claims.id, name: claims.name, provider: claims.provider };
}

export function parseCookie(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return null;
}

export interface CookieOptions {
  path?: string;
  maxAge?: number; // seconds; 0 clears the cookie
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Lax" | "Strict" | "None";
}

export function serializeCookie(name: string, value: string, opts: CookieOptions = {}): string {
  const segments = [`${name}=${value}`];
  if (opts.path) segments.push(`Path=${opts.path}`);
  if (opts.maxAge !== undefined) segments.push(`Max-Age=${opts.maxAge}`);
  if (opts.httpOnly) segments.push("HttpOnly");
  if (opts.secure) segments.push("Secure");
  if (opts.sameSite) segments.push(`SameSite=${opts.sameSite}`);
  return segments.join("; ");
}

export function randomState(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function buildGoogleAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid profile",
    state,
    access_type: "online",
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export function buildGithubAuthorizeUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, scope: "read:user", state });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

export interface OAuthUser {
  id: string;
  name: string;
}

export async function exchangeGoogleCode(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<OAuthUser | null> {
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!tokenRes.ok) return null;
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) return null;

  const userRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });
  if (!userRes.ok) return null;
  const userJson = (await userRes.json()) as { sub?: string; name?: string; email?: string };
  if (!userJson.sub) return null;
  return { id: `google:${userJson.sub}`, name: userJson.name ?? userJson.email ?? "Google user" };
}

export async function exchangeGithubCode(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<OAuthUser | null> {
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri }).toString(),
  });
  if (!tokenRes.ok) return null;
  const tokenJson = (await tokenRes.json()) as { access_token?: string };
  if (!tokenJson.access_token) return null;

  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${tokenJson.access_token}`,
      "User-Agent": "frontstage-relay",
      Accept: "application/vnd.github+json",
    },
  });
  if (!userRes.ok) return null;
  const userJson = (await userRes.json()) as { id?: number; login?: string; name?: string };
  if (userJson.id === undefined) return null;
  return { id: `gh:${userJson.id}`, name: userJson.name ?? userJson.login ?? "GitHub user" };
}
