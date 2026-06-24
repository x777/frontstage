import { _electron as electron, test, expect } from "@playwright/test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import * as path from "node:path";

// Canned SSE body: one text delta, one tool_call (streamed across 2 events), finish, done
const CANNED_SSE = [
  `data: ${JSON.stringify({ choices: [{ delta: { content: "hello" }, finish_reason: null }] })}\n\n`,
  `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "get_timeline", arguments: "" } }] }, finish_reason: null }] })}\n\n`,
  `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "{}" } }] }, finish_reason: null }] })}\n\n`,
  `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "tool_calls" }] })}\n\n`,
  `data: [DONE]\n\n`,
].join("");

test("DesktopAiGateway: setKey/hasKey/streamChat/clearKey + key attached in main", async () => {
  // Start fake OpenRouter upstream
  let capturedAuth = "";
  const server = http.createServer((req, res) => {
    capturedAuth = req.headers["authorization"] as string ?? "";
    if (req.method === "POST" && req.url === "/chat/completions") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.end(CANNED_SSE);
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const fakePort = (server.address() as AddressInfo).port;

  const app = await electron.launch({
    args: [path.join(__dirname, "../src/main/index.cjs")],
    cwd: path.join(__dirname, ".."),
    env: {
      ...process.env,
      RENDERER_PORT: "5190",
      PALMIER_E2E: "1",
      OPENROUTER_BASE_URL: `http://127.0.0.1:${fakePort}`,
    },
  });

  try {
    const page = await app.firstWindow();
    await page.goto(`http://localhost:5190/ai-gateway-test.html`);
    page.on("console", (msg) => console.log("[renderer]", msg.type(), msg.text()));
    page.on("pageerror", (err) => console.error("[renderer pageerror]", err.message));

    await page.waitForFunction(
      () => typeof (window as any).__DesktopAiGateway === "function",
      { timeout: 15_000 },
    );

    // setKey + hasKey
    await page.evaluate(async () => {
      await (window as any).desktopAI.setKey("test-key-123");
    });
    const hasKey = await page.evaluate(() => (window as any).desktopAI.hasKey());
    expect(hasKey).toBe(true);

    // streamChat — collect all events
    const events = await page.evaluate(async () => {
      const gw = new (window as any).__DesktopAiGateway();
      const collected: unknown[] = [];
      for await (const ev of gw.streamChat({
        model: "openai/gpt-4o-mini",
        system: "sys",
        tools: (window as any).__buildCatalog(),
        messages: [{ role: "user", content: "hi" }],
      })) {
        collected.push(ev);
      }
      return collected;
    });

    const types = (events as { type: string }[]).map((e) => e.type);
    expect(types.filter((t) => t === "textDelta").length).toBeGreaterThanOrEqual(1);
    expect(types.filter((t) => t === "toolCallComplete").length).toBe(1);
    expect(types.filter((t) => t === "done").length).toBe(1);

    const toolCall = (events as any[]).find((e) => e.type === "toolCallComplete");
    expect(toolCall?.name).toBe("get_timeline");

    const done = (events as any[]).find((e) => e.type === "done");
    expect(done?.finishReason).toBe("tool_calls");

    // SECURITY: key was attached in main process, never leaked to renderer
    expect(capturedAuth).toBe("Bearer test-key-123");

    // clearKey + hasKey
    await page.evaluate(() => (window as any).desktopAI.clearKey());
    const hasKeyAfter = await page.evaluate(() => (window as any).desktopAI.hasKey());
    expect(hasKeyAfter).toBe(false);
  } finally {
    await app.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
