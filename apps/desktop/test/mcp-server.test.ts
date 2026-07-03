import { describe, expect, test } from "vitest";
import net from "node:net";
import { startMcpServer } from "../src/main/mcp/server.mjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// Swift's #250 fixed a real bug: MCPHTTPServer hand-parsed HTTP off raw NWConnection reads, so a
// tool-call body spanning multiple TCP reads got parsed truncated. Our server.mjs never had that
// bug — it's Node's `http` module (readBody drains the request stream via 'data'/'end', which
// Node's own parser only fires once the full Content-Length/chunked body has arrived) plus the
// MCP SDK's StreamableHTTPServerTransport, not a hand-rolled framer. This test proves it: a >64KB
// tool-call argument round-trips intact.

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
    probe.on("error", reject);
  });
}

const TOOL_INPUT_SCHEMA = {
  type: "object" as const,
  properties: { payload: { type: "string" } },
  required: ["payload"],
};

describe("startMcpServer: request framing", () => {
  test("a >64KB tool-call argument round-trips intact (not truncated)", async () => {
    const port = await getFreePort();
    const token = "test-token";
    let receivedLength = -1;
    const bridge = async (kind: string, payload?: unknown) => {
      if (kind === "listTools") {
        return [{ name: "echo", description: "echoes payload length", inputSchema: TOOL_INPUT_SCHEMA }];
      }
      if (kind === "callTool") {
        const args = (payload as { args: { payload: string } }).args;
        receivedLength = args.payload.length;
        return { blocks: [{ kind: "text", text: String(args.payload.length) }], isError: false };
      }
      throw new Error("unexpected bridge kind: " + kind);
    };

    const server = await startMcpServer({ port, token, bridge });
    try {
      const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      });
      const client = new Client({ name: "test-client", version: "1.0.0" });
      await client.connect(transport);

      const bigPayload = "x".repeat(200_000); // well past the 64KB floor and past a single 64KB TCP read
      const result = await client.callTool({ name: "echo", arguments: { payload: bigPayload } });

      expect(receivedLength).toBe(bigPayload.length);
      const content = result.content as Array<{ type: string; text?: string }>;
      expect(content[0]?.text).toBe(String(bigPayload.length));

      await client.close();
    } finally {
      await server.close();
    }
  });
});
