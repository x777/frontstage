import { _electron as electron, test, expect } from "@playwright/test";
import http from "node:http";
import * as path from "node:path";

const MCP_PORT = 19790;

function httpGet(url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      let body = "";
      res.on("data", (d) => { body += d; });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on("error", reject);
    req.setTimeout(3000, () => { req.destroy(new Error("timeout")); });
  });
}

test("MCP server: 200 with token, 401 no token, 403 bad origin, regenerate, disabled", async () => {
  const app = await electron.launch({
    args: [path.join(__dirname, "../src/main/index.cjs")],
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      RENDERER_PORT: "5190",
      PALMIER_E2E: "1",
      MCP_PORT: String(MCP_PORT),
    },
  });

  try {
    const page = await app.firstWindow();
    page.on("console", (msg) => console.log("[renderer]", msg.type(), msg.text()));
    page.on("pageerror", (err) => console.error("[renderer pageerror]", err.message));

    await page.waitForLoadState("domcontentloaded", { timeout: 15_000 });

    // Enable the MCP server
    await page.evaluate(async () => {
      await (window as any).desktopMcp.setEnabled(true);
    });

    // getStatus: must be running with a 64-char hex token
    const status = await page.evaluate(async () => {
      return (window as any).desktopMcp.getStatus();
    });
    expect(status.running).toBe(true);
    expect(status.enabled).toBe(true);
    expect(typeof status.token).toBe("string");
    expect(status.token).toMatch(/^[0-9a-f]{64}$/);

    const token: string = status.token;

    // 1. 200 with correct token
    const r200 = await httpGet(`http://127.0.0.1:${MCP_PORT}/healthz`, {
      Authorization: `Bearer ${token}`,
    });
    expect(r200.status).toBe(200);
    expect(r200.body).toBe("ok");

    // 2. 401 without token
    const r401 = await httpGet(`http://127.0.0.1:${MCP_PORT}/healthz`);
    expect(r401.status).toBe(401);

    // 3. 401 with wrong token
    const r401wrong = await httpGet(`http://127.0.0.1:${MCP_PORT}/healthz`, {
      Authorization: "Bearer wrongtoken",
    });
    expect(r401wrong.status).toBe(401);

    // 4. 403 with bad origin (even with correct token)
    const r403 = await httpGet(`http://127.0.0.1:${MCP_PORT}/healthz`, {
      Authorization: `Bearer ${token}`,
      Origin: "http://evil.com",
    });
    expect(r403.status).toBe(403);

    // 4b. 403 with spoofed Host header (DNS-rebinding defense)
    const r403host = await httpGet(`http://127.0.0.1:${MCP_PORT}/healthz`, {
      Authorization: `Bearer ${token}`,
      Host: "evil.com",
    });
    expect(r403host.status).toBe(403);

    // 5. regenerateToken: old token → 401, new token → 200
    const newToken: string = await page.evaluate(async () => {
      return (window as any).desktopMcp.regenerateToken();
    });
    expect(newToken).toMatch(/^[0-9a-f]{64}$/);
    expect(newToken).not.toBe(token);

    const rOldToken = await httpGet(`http://127.0.0.1:${MCP_PORT}/healthz`, {
      Authorization: `Bearer ${token}`,
    });
    expect(rOldToken.status).toBe(401);

    const rNewToken = await httpGet(`http://127.0.0.1:${MCP_PORT}/healthz`, {
      Authorization: `Bearer ${newToken}`,
    });
    expect(rNewToken.status).toBe(200);

    // 6. setEnabled(false) → connection refused
    await page.evaluate(async () => {
      await (window as any).desktopMcp.setEnabled(false);
    });

    await expect(
      httpGet(`http://127.0.0.1:${MCP_PORT}/healthz`, { Authorization: `Bearer ${newToken}` }),
    ).rejects.toThrow();

    // Re-enable to test MCP client
    await page.evaluate(async () => {
      await (window as any).desktopMcp.setEnabled(true);
    });

    const status2 = await page.evaluate(async () => {
      return (window as any).desktopMcp.getStatus();
    });
    const liveToken: string = status2.token;

    // 7. MCP client: connect with token → initialize succeeds → listTools → ping stub
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js" as any);
    const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js" as any);

    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${MCP_PORT}/mcp`),
      { requestInit: { headers: { Authorization: `Bearer ${liveToken}` } } },
    );
    const client = new Client({ name: "test", version: "0.0.0" }, { capabilities: {} });
    await client.connect(transport);

    const toolsResult = await client.listTools();
    expect(Array.isArray(toolsResult.tools)).toBe(true);

    // Real catalog: 14 tools from the renderer bridge (not the stub ping)
    expect(toolsResult.tools.length).toBe(14);
    const toolNames = toolsResult.tools.map((t: any) => t.name);
    expect(toolNames).toContain("add_clips");
    expect(toolNames).toContain("add_texts");
    expect(toolNames).toContain("get_timeline");
    expect(toolNames).toContain("generate_image");
    for (const t of toolsResult.tools) {
      expect(typeof t.inputSchema).toBe("object");
    }

    // Bridge round-trip: real tools prove main→renderer→main path works
    const pingTool = toolsResult.tools.find((t: any) => t.name === "ping");
    expect(pingTool).toBeUndefined(); // stub is gone

    await client.close();

    // 8. MCP client WITHOUT token → connect rejects (401)
    const transportNoAuth = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${MCP_PORT}/mcp`),
    );
    const clientNoAuth = new Client({ name: "test-noauth", version: "0.0.0" }, { capabilities: {} });
    let connectError: unknown;
    try {
      await clientNoAuth.connect(transportNoAuth);
    } catch (err) {
      connectError = err;
    }
    expect(connectError).toBeDefined();

    await transportNoAuth.close().catch(() => {});
  } finally {
    await app.close();
  }
});
