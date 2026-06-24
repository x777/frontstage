import { createProxyServer } from "./server.js";

// CLI entry point.
// Env vars:
//   OPENROUTER_API_KEY  [required]  Upstream API key forwarded to OpenRouter.
//   ALLOW_ORIGIN        [required]  Exact origin the proxy allows, e.g. https://app.example.com.
//   PROXY_TOKEN         [recommended] Shared secret; clients send Authorization: Bearer <token>.
//   HOST                [optional]  Bind address (default: 127.0.0.1).
//   PORT                [optional]  Bind port (default: 8787).

const apiKey = process.env["OPENROUTER_API_KEY"];
if (!apiKey) {
  console.error("OPENROUTER_API_KEY is required");
  process.exit(1);
}

const allowOrigin = process.env["ALLOW_ORIGIN"];
if (!allowOrigin) {
  console.error("ALLOW_ORIGIN is required (e.g. https://your-app.com)");
  process.exit(1);
}

const proxyToken = process.env["PROXY_TOKEN"];
if (!proxyToken) {
  console.warn("Warning: PROXY_TOKEN is not set — the proxy is unauthenticated. Only bind to localhost or a trusted network.");
}

const port = Number(process.env["PORT"] ?? 8787);
const host = process.env["HOST"] ?? "127.0.0.1";

const server = createProxyServer({ apiKey, allowOrigin, proxyToken });
server.listen(port, host, () => {
  console.log(`Proxy listening on http://${host}:${port}`);
});
