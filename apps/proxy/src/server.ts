import http from "node:http";

export interface ProxyServerOptions {
  apiKey: string;
  upstreamBaseUrl?: string;
  allowOrigin?: string;
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export function createProxyServer(opts: ProxyServerOptions): http.Server {
  const origin = opts.allowOrigin ?? "*";
  const upstream = opts.upstreamBaseUrl ?? "https://openrouter.ai/api/v1";

  return http.createServer((req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders(origin));
      res.end();
      return;
    }

    if (req.method === "GET" && req.url === "/healthz") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      return;
    }

    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf-8");
        forward(body, upstream, opts.apiKey, origin, res);
      });
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });
}

async function forward(body: string, upstream: string, apiKey: string, origin: string, res: http.ServerResponse): Promise<void> {
  try {
    const upstreamRes = await fetch(upstream + "/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://palmier.pro",
        "X-Title": "PalmierPro",
      },
      body,
    });

    const responseHeaders: Record<string, string> = {
      "Access-Control-Allow-Origin": origin,
    };

    const ct = upstreamRes.headers.get("content-type");
    if (ct) responseHeaders["Content-Type"] = ct;

    res.writeHead(upstreamRes.status, responseHeaders);

    if (!upstreamRes.body) {
      res.end();
      return;
    }

    for await (const chunk of upstreamRes.body as AsyncIterable<Uint8Array>) {
      res.write(chunk);
    }
    res.end();
  } catch {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain", "Access-Control-Allow-Origin": origin });
    }
    res.end("Bad gateway");
  }
}
