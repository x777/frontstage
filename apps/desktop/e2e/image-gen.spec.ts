import { _electron as electron, test, expect } from "@playwright/test";
import http from "node:http";
import type { AddressInfo } from "node:net";
import * as path from "node:path";

// Canned OpenRouter non-streaming image response
const CANNED_IMAGE_JSON = JSON.stringify({
  choices: [
    {
      message: {
        images: [
          { type: "image_url", image_url: { url: "data:image/png;base64,FAKEIMAGEDATA" } },
        ],
      },
    },
  ],
});

test("DesktopAiGateway.generateImage: key attached in main, image returned to renderer", async () => {
  let capturedAuth = "";
  let capturedBody = "";

  const server = http.createServer((req, res) => {
    capturedAuth = (req.headers["authorization"] as string) ?? "";
    if (req.method === "POST" && req.url === "/chat/completions") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        capturedBody = body;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(CANNED_IMAGE_JSON);
      });
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
      FRONTSTAGE_E2E: "1",
      OPENROUTER_BASE_URL: `http://127.0.0.1:${fakePort}`,
    },
  });

  try {
    const page = await app.firstWindow();
    await page.goto(`http://localhost:5190/image-gen-test.html`);
    page.on("console", (msg) => console.log("[renderer]", msg.type(), msg.text()));
    page.on("pageerror", (err) => console.error("[renderer pageerror]", err.message));

    await page.waitForFunction(
      () => typeof (window as any).__DesktopAiGateway === "function",
      { timeout: 15_000 },
    );

    // Set key in main process via desktopAI bridge
    await page.evaluate(async () => {
      await (window as any).desktopAI.setKey("test-key");
    });

    // Call generateImage from the renderer via the gateway
    const result = await page.evaluate(async () => {
      const gw = new (window as any).__DesktopAiGateway();
      return await gw.generateImage({ model: "openai/gpt-image-1", prompt: "a cat" });
    });

    // The canned value makes it back to the renderer
    expect((result as any).images).toHaveLength(1);
    expect((result as any).images[0].base64).toBe("FAKEIMAGEDATA");
    expect((result as any).images[0].mediaType).toBe("image/png");

    // SECURITY: key was attached in main, not in renderer — upstream saw it
    expect(capturedAuth).toBe("Bearer test-key");

    // Body was non-streaming
    const parsed = JSON.parse(capturedBody);
    expect(parsed.stream).toBe(false);
    expect(parsed.modalities).toContain("image");
    expect(parsed.messages[0].content[0].text).toBe("a cat");
  } finally {
    await app.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
