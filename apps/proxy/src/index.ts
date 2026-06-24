import { createProxyServer } from "./server.js";

// CLI entry: OPENROUTER_API_KEY=sk-... node dist/index.js
// Optional: PORT=8787 ALLOW_ORIGIN=https://your-app.com
const apiKey = process.env["OPENROUTER_API_KEY"];
if (!apiKey) {
  console.error("OPENROUTER_API_KEY is required");
  process.exit(1);
}

const port = Number(process.env["PORT"] ?? 8787);
const allowOrigin = process.env["ALLOW_ORIGIN"];

const server = createProxyServer({ apiKey, allowOrigin });
server.listen(port, () => {
  console.log(`Proxy listening on http://localhost:${port}`);
});
