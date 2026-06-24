import http from "node:http";
import { checkAuth } from "./auth.mjs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

function toMcpResult(result) {
  return {
    content: (result.blocks ?? []).map((b) =>
      b.kind === "image"
        ? { type: "image", data: b.base64, mimeType: b.mediaType }
        : { type: "text", text: b.text },
    ),
    isError: !!result.isError,
  };
}

function createMcpServer(bridge) {
  const mcp = new Server(
    { name: "palmier-pro", version: "0.1.0" },
    { capabilities: { tools: {}, resources: {} } },
  );
  mcp.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await bridge("listTools") }));
  mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
      const toolResult = await bridge("callTool", { name: req.params.name, args: req.params.arguments ?? {} });
      return toMcpResult(toolResult);
    } catch (e) {
      return { content: [{ type: "text", text: "editor not ready: " + String(e) }], isError: true };
    }
  });
  return mcp;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) { resolve(undefined); return; }
      try { resolve(JSON.parse(raw)); } catch { resolve(undefined); }
    });
    req.on("error", reject);
  });
}

export async function startMcpServer({ port, token, bridge }) {
  const server = http.createServer(async (req, res) => {
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

    const url = req.url?.split("?")[0];
    if (url === "/mcp" && (req.method === "POST" || req.method === "GET" || req.method === "DELETE")) {
      const parsedBody = req.method === "POST" ? await readBody(req) : undefined;
      // stateless mode: new Server + transport per request
      const mcp = createMcpServer(bridge);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await mcp.connect(transport);
      res.on("close", () => { transport.close(); mcp.close(); });
      await transport.handleRequest(req, res, parsedBody);
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
