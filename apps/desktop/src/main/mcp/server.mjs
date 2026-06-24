import http from "node:http";
import { checkAuth } from "./auth.mjs";

export async function startMcpServer({ port, token }) {
  const server = http.createServer((req, res) => {
    const a = checkAuth(req, token);
    if (!a.ok) {
      res.writeHead(a.status);
      res.end();
      return;
    }
    if (req.method === "GET" && req.url === "/healthz") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      return;
    }
    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(port, "127.0.0.1", resolve); // bind 127.0.0.1 ONLY — never 0.0.0.0
  });

  return {
    close: () => new Promise((r) => server.close(() => r())),
    port,
  };
}
