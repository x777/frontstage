# Self-hosting

The web editor at [frontstage.studio](https://frontstage.studio) runs against a hosted
relay (a Cloudflare Worker at `/api`, still your own OpenRouter/fal.ai keys, just
passed through — see the M18C work for that specific setup). This doc is for
running your **own** copy of the web app against your **own** relay: the
`apps/proxy` Node server in this repo.

The desktop app doesn't need any of this — it talks to OpenRouter and fal.ai
directly and stores keys in your OS keychain. This page is web-only.

## 1. The web app

```sh
pnpm -F @frontstage/web dev      # dev server, http://localhost:5181
pnpm -F @frontstage/web build    # production build -> apps/web/dist
pnpm -F @frontstage/web preview  # serves dist/ locally, http://localhost:5181
```

### COOP/COEP headers

The engine's audio pipeline mixes on `SharedArrayBuffer`, which browsers only
hand out to a **cross-origin-isolated** page. That requires two response
headers on every document request:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

`vite dev` and `vite preview` already set these (see the `crossOriginIsolation`
plugin in `apps/web/vite.config.ts`) — that's fine for local use, but neither
is meant to serve production traffic. Once you deploy the `dist/` build behind
your own static host or reverse proxy, you must add those two headers there
yourself; the repo doesn't ship a hosting-specific config for this. For
example, on Nginx:

```nginx
location / {
  add_header Cross-Origin-Opener-Policy same-origin;
  add_header Cross-Origin-Embedder-Policy require-corp;
  try_files $uri /index.html;
}
```

Most static hosts (Cloudflare Pages, Netlify, Vercel) have their own
headers-config mechanism (`_headers` file, `vercel.json`, etc.) — set the same
two headers there instead. Without them, generation still works but audio
mixing silently degrades or errors.

## 2. The proxy

`apps/proxy` is a small Node HTTP server: it holds your OpenRouter and (optionally)
fal.ai keys server-side so the browser never sees them, and forwards the
editor's AI calls upstream.

```sh
pnpm -F @frontstage/proxy start   # runs src/index.ts via tsx
```

Configured entirely by environment variables (see `apps/proxy/src/index.ts`):

| Variable | Required | Default | What it does |
|---|---|---|---|
| `OPENROUTER_API_KEY` | **yes** | — | Upstream key forwarded to OpenRouter for the agent's `/v1/chat/completions` calls. |
| `ALLOW_ORIGIN` | **yes** | — | The exact origin allowed to call the proxy (e.g. `https://your-app.example.com`). Must be a specific origin — the server refuses to start with `*`. |
| `PROXY_TOKEN` | recommended | — | Shared secret. When set, every route requires `Authorization: Bearer <PROXY_TOKEN>`. When unset, the proxy is unauthenticated and only origin-checked — the server logs a warning and you should only run it on localhost or a network you trust. |
| `FAL_KEY` | no | — | Your fal.ai queue API key. Enables the `/fal/*` routes (generation, upscale). Omit it and those routes 503. |
| `FAL_UPSTREAM` | no | `https://queue.fal.run` | fal queue base URL. |
| `FAL_REST_UPSTREAM` | no | `https://rest.fal.ai` | fal REST base URL, used for storage uploads. |
| `HOST` | no | `127.0.0.1` | Bind address. |
| `PORT` | no | `8787` | Bind port. |

```sh
OPENROUTER_API_KEY=sk-or-v1-... \
ALLOW_ORIGIN=https://your-app.example.com \
PROXY_TOKEN=$(openssl rand -hex 32) \
FAL_KEY=... \
pnpm -F @frontstage/proxy start
```

### Pointing the web app at your proxy

The web app defaults to `http://localhost:8787` (baked in at build time via
`VITE_AI_PROXY_URL` / `VITE_AI_PROXY_TOKEN` env vars, read in `apps/web/src/main.tsx`).
To point a built app at a different proxy without rebuilding, open the editor's
**Settings → Agent → OpenRouter** section: it shows a **Proxy endpoint** URL
field and an optional **Token** field. Save writes both to the browser's
`localStorage` (`frontstage.ai.proxyUrl` / `frontstage.ai.proxyToken`), which
takes precedence over the build-time default on reload.

fal.ai has no key field in the web UI at all — it's proxy-only. The same
Settings pane just reports whether the proxy has `FAL_KEY` configured
(`fal.ai: configured on proxy ✓` / `...not configured — set FAL_KEY on your proxy`),
read from the proxy's `GET /fal/enabled`.

## 3. Security notes (already built into the proxy)

- **Origin lock.** `ALLOW_ORIGIN` must be an exact origin; every response's
  `Access-Control-Allow-Origin` is that one origin, never `*`.
- **Token auth.** `PROXY_TOKEN`, when set, gates every route with a
  timing-safe `Authorization: Bearer` comparison.
- **fal path/job validation.** `/fal/submit` and `/fal/status` regex-validate
  the model endpoint and job id before splicing them into the upstream URL —
  no `..`, no leading slash, no path traversal.
- **fal download allowlist.** `/fal/download` only follows `https://` URLs on
  `fal.media` / `*.fal.media` / `*.fal.run`, re-checking the allowlist on every
  redirect hop (max 3), and serves the result as `Content-Disposition: attachment`
  with `X-Content-Type-Options: nosniff` and a locked-down CSP — nothing it
  proxies ever executes as HTML from the proxy's own origin.
- **General-host import SSRF guard.** `/import/download` backs `import_media`'s
  URL source and can't be limited to one allowlisted host, so instead it
  denies the *shapes* an attacker would use to reach internal/metadata
  services (non-`https`, credentials-in-URL, `localhost`, literal IPv4/IPv6
  hosts) and then actually **resolves DNS and rejects private/internal
  addresses**, pinning the connection to the exact resolved address it just
  checked — closing the DNS-rebinding gap where a hostname could re-resolve
  between the check and the connect. Every redirect hop repeats the full
  check. Downloads are capped at 5 GB and a 15-minute timeout, and the response
  is neutralized (attachment, nosniff, locked CSP) the same as fal downloads.
- **Upload guards.** `/fal/upload` requires an `audio/* | image/* | video/*`
  content type, enforces a 50 MB cap while buffering (not after reading the
  whole body), and the signed upload URL fal hands back is re-validated
  against a fal-hosts allowlist before the proxy `PUT`s to it.

None of this is a substitute for `PROXY_TOKEN` — run the proxy behind a token
on anything reachable outside your own machine.
