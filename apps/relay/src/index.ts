import {
  buildGithubAuthorizeUrl,
  buildGoogleAuthorizeUrl,
  exchangeGithubCode,
  exchangeGoogleCode,
  parseCookie,
  randomState,
  serializeCookie,
  signSession,
  verifySession,
  type SessionPayload,
} from "./auth.js";
import { checkAndCount } from "./limits.js";
import {
  handleChatCompletions,
  handleFalDownload,
  handleFalEnabled,
  handleFalStatus,
  handleFalSubmit,
  handleFalUpload,
  handleImportDownload,
} from "./relay.js";

export interface Env {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  JWT_SECRET: string;
  RATE: KVNamespace;
}

const SITE_ORIGIN = "https://frontstage.studio";
const SESSION_COOKIE = "fs_session";
const STATE_COOKIE = "fs_oauth_state";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days
const STATE_TTL_SECONDS = 600; // 10 minutes — just long enough for the OAuth round trip
const DAILY_LIMIT = 2000;

const SESSION_COOKIE_OPTS = { path: "/api", httpOnly: true, secure: true, sameSite: "Lax" as const };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function getSession(request: Request, env: Env): Promise<SessionPayload | null> {
  const token = parseCookie(request.headers.get("Cookie"), SESSION_COOKIE);
  if (!token) return null;
  return verifySession(token, env.JWT_SECRET);
}

type Provider = "google" | "github";

function callbackRedirectUri(url: URL, provider: Provider): string {
  return `${url.origin}/api/auth/${provider}/callback`;
}

function handleAuthorize(provider: Provider, env: Env, url: URL): Response {
  const state = randomState();
  const redirectUri = callbackRedirectUri(url, provider);
  const authorizeUrl =
    provider === "google"
      ? buildGoogleAuthorizeUrl(env.GOOGLE_CLIENT_ID, redirectUri, state)
      : buildGithubAuthorizeUrl(env.GITHUB_CLIENT_ID, redirectUri, state);

  const headers = new Headers({ Location: authorizeUrl });
  headers.append(
    "Set-Cookie",
    serializeCookie(STATE_COOKIE, state, { path: "/api/auth", maxAge: STATE_TTL_SECONDS, httpOnly: true, secure: true, sameSite: "Lax" }),
  );
  return new Response(null, { status: 302, headers });
}

async function handleCallback(provider: Provider, env: Env, request: Request, url: URL): Promise<Response> {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = parseCookie(request.headers.get("Cookie"), STATE_COOKIE);
  if (!code || !state || !cookieState || state !== cookieState) {
    return new Response("Invalid OAuth state", { status: 400 });
  }

  const redirectUri = callbackRedirectUri(url, provider);
  const user =
    provider === "google"
      ? await exchangeGoogleCode(code, env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, redirectUri)
      : await exchangeGithubCode(code, env.GITHUB_CLIENT_ID, env.GITHUB_CLIENT_SECRET, redirectUri);
  if (!user) return new Response("OAuth exchange failed", { status: 502 });

  const token = await signSession({ id: user.id, name: user.name, provider }, env.JWT_SECRET, SESSION_TTL_SECONDS);
  const headers = new Headers({ Location: `${SITE_ORIGIN}/studio/` });
  headers.append("Set-Cookie", serializeCookie(SESSION_COOKIE, token, { ...SESSION_COOKIE_OPTS, maxAge: SESSION_TTL_SECONDS }));
  headers.append("Set-Cookie", serializeCookie(STATE_COOKIE, "", { path: "/api/auth", maxAge: 0, httpOnly: true, secure: true, sameSite: "Lax" }));
  return new Response(null, { status: 302, headers });
}

function handleLogout(): Response {
  const headers = new Headers();
  headers.append("Set-Cookie", serializeCookie(SESSION_COOKIE, "", { ...SESSION_COOKIE_OPTS, maxAge: 0 }));
  return new Response(null, { status: 204, headers });
}

async function handleMe(request: Request, env: Env): Promise<Response> {
  const session = await getSession(request, env);
  if (!session) return json({ error: "unauthorized" }, 401);
  return json({ user: session });
}

// Routes exempt from the session gate: OAuth itself (nothing to authenticate yet) and the health
// check (infra monitoring has no session to send, same as apps/proxy/src/server.ts's open /healthz).
function isPublicRoute(pathname: string, method: string): boolean {
  if (pathname === "/healthz" && method === "GET") return true;
  return pathname.startsWith("/auth/");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api")) return new Response("Not found", { status: 404 });
    const pathname = url.pathname.slice(4) || "/";

    // Belt-and-braces CSRF: same-origin only, no CORS headers are ever sent (see AGENTS brief).
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      const origin = request.headers.get("Origin");
      if (origin && origin !== SITE_ORIGIN) return new Response("Forbidden", { status: 403 });
    }

    if (pathname === "/healthz" && request.method === "GET") return new Response("ok");
    if (pathname === "/auth/google" && request.method === "GET") return handleAuthorize("google", env, url);
    if (pathname === "/auth/github" && request.method === "GET") return handleAuthorize("github", env, url);
    if (pathname === "/auth/google/callback" && request.method === "GET") return handleCallback("google", env, request, url);
    if (pathname === "/auth/github/callback" && request.method === "GET") return handleCallback("github", env, request, url);
    if (pathname === "/auth/logout" && request.method === "POST") return handleLogout();
    if (pathname === "/auth/me" && request.method === "GET") return handleMe(request, env);

    if (isPublicRoute(pathname, request.method)) return new Response("Not found", { status: 404 });

    const session = await getSession(request, env);
    if (!session) return json({ error: "unauthorized" }, 401);

    const allowed = await checkAndCount(env.RATE, session.id, DAILY_LIMIT);
    if (!allowed) return json({ error: "rate limit exceeded" }, 429);

    if (pathname === "/v1/chat/completions" && request.method === "POST") return handleChatCompletions(request);
    if (pathname === "/fal/enabled" && request.method === "GET") return handleFalEnabled(request);
    if (pathname === "/fal/submit" && request.method === "POST") return handleFalSubmit(request);
    if (pathname === "/fal/status" && request.method === "GET") return handleFalStatus(request, url);
    if (pathname === "/fal/download" && request.method === "GET") return handleFalDownload(url);
    if (pathname === "/fal/upload" && request.method === "POST") return handleFalUpload(request, url);
    if (pathname === "/import/download" && request.method === "POST") return handleImportDownload(request);

    return new Response("Not found", { status: 404 });
  },
};
