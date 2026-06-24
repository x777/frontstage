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
  } finally {
    await app.close();
  }
});
