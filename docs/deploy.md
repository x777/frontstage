# Deploying frontstage.studio

This is the runbook for the one Cloudflare deploy that serves frontstage.studio:
a Pages project (landing page at `/` + the web editor at `/studio/`) and a
Worker (the relay, mounted on the same zone at `/api/*`). There is no separate
relay subdomain — see `apps/relay/wrangler.toml`'s `routes`.

For self-hosting your own copy against your own relay, see
[`self-host.md`](self-host.md) instead — this doc is specifically about the
`frontstage.studio` production deploy.

## 0. Build the deploy directory (no Cloudflare account needed)

```sh
node scripts/build-site.mjs
```

Produces `deploy/`:

```
deploy/
  index.html          <- site/index.html (the landing page)
  assets/              <- site/assets/* (banner, hero, favicon)
  _headers             <- COOP/COEP for /studio/*, merged from apps/web/public/_headers
  studio/
    index.html          <- apps/web production build, base "/studio/"
    assets/              <- hashed JS/CSS/wasm
```

The web build runs with `VITE_RELAY_MODE=1` (set by the script, not your
shell) — this is what switches the editor from self-host proxy mode to the
Google/GitHub sign-in + relay-gateway mode built in M18C.

`deploy/` is gitignored — it's a build artifact, regenerate it, don't commit
it.

## 1. Prerequisites — USER-ACTION checklist

Everything below needs a human with account access. Nothing here can be
scripted by an agent from this repo alone.

- [ ] **USER** — Cloudflare account with `frontstage.studio` added as a zone
  (DNS managed by Cloudflare).
- [ ] **USER** — Google OAuth app (Google Cloud Console → APIs & Services →
  Credentials → OAuth client ID, type "Web application"). Authorized redirect
  URI:
  ```
  https://frontstage.studio/api/auth/google/callback
  ```
  Save the client ID and client secret — needed in step 3.
- [ ] **USER** — GitHub OAuth app (GitHub → Settings → Developer settings →
  OAuth Apps → New OAuth App). Authorization callback URL:
  ```
  https://frontstage.studio/api/auth/github/callback
  ```
  Save the client ID and client secret — needed in step 3.
- [ ] **USER** — Ko-fi page live at `ko-fi.com/frontstage` (the landing
  footer and navbar already link there).
- [x] **USER** — crypto donation address in `DONATE.md` — already filled in
  (ETH/USDT/USDC, any EVM chain). Nothing to do unless the address changes.

## 2. Auth, KV, and secrets — agent + user together

Run from the repo root unless noted. `wrangler login` opens a browser — only
the user can complete it.

```sh
# 1. Auth (interactive — USER completes the browser flow)
npx wrangler login

# 2. Create the rate-limit KV namespace (agent can run this once logged in)
cd apps/relay
npx wrangler kv namespace create RATE
```

That prints something like:

```
{ "binding": "RATE", "id": "<generated-id>" }
```

Paste `<generated-id>` into `apps/relay/wrangler.toml`'s `kv_namespaces` block,
replacing `TBD-at-deploy`:

```toml
kv_namespaces = [
  { binding = "RATE", id = "<generated-id>" }
]
```

```sh
# 3. Secrets (interactive — USER supplies each value at the prompt; the OAuth
#    client IDs/secrets are from step 1, JWT_SECRET is any long random string
#    you generate, e.g. `openssl rand -hex 32`)
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put JWT_SECRET

# 4. Deploy the Worker. The /api/* route on the frontstage.studio zone
#    attaches automatically from wrangler.toml's `routes` — no separate
#    Worker domain to configure.
npx wrangler deploy
```

## 3. Pages — the landing page + `/studio`

From the repo root:

```sh
# Build deploy/ fresh (repeat any time site/ or apps/web changes)
node scripts/build-site.mjs

# One-time: create the Pages project
npx wrangler pages project create frontstage --production-branch=main

# Every deploy: upload deploy/
npx wrangler pages deploy deploy/ --project-name=frontstage
```

Then attach the custom domain (Pages custom domains are dashboard/API only —
there's no `wrangler pages domain add` subcommand):

- [ ] **USER** — Cloudflare dashboard → Workers & Pages → **frontstage** →
  Custom domains → Add a domain → `frontstage.studio` → Activate domain.

## 4. Deploy + live smoke (controller runs this after 1–3 are done)

Each check below needs the live deploy from steps 1–3.

- [ ] `https://frontstage.studio/` loads the landing page.
- [ ] `https://frontstage.studio/studio/` boots the editor with no login
  required — import a local file, confirm the timeline works.
- [ ] Sign-in roundtrip completes for both Google and GitHub (cookie
  `fs_session` set, `/api/auth/me` returns the user).
- [ ] With a real fal.ai key saved in Settings, a cheap generation (e.g.
  nano-banana, ~$0.04 — get spend approval before running) completes through
  the relay end to end.
- [ ] In the `/studio/` browser console: `crossOriginIsolated === true`
  (confirms the `_headers` COOP/COEP block is being served, not just present
  in the build).
- [ ] Rate-limit sanity: the relay has no dedicated rate-limit response
  header — normal traffic should just pass through; only confirm exceeding
  the per-session daily cap (2000 requests) returns `429` with
  `{"error":"rate limit exceeded"}` if you have a fast way to trigger it, this
  isn't worth burning a real budget on.

If steps 1–3's user-action items aren't done yet, everything up to here (the
build, the script, this doc) is still complete — hand this checklist to
whoever owns the Cloudflare account and OAuth apps.

## 5. After going live

Update README's "Open Studio" link if it still points anywhere else, and
merge/tag as usual.
