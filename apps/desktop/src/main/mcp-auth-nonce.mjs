// Single-use nonces binding project:authorizePath (M13B final-review H-2) to an in-flight MCP
// tool-call forward. Minted only inside index.cjs's mcpBridge() when it dispatches a "callTool"
// request to the renderer, so a pickerless authorize requires a live MCP tool call in progress —
// not just knowledge of an existing path. No `electron` import, so this loads under plain Node
// (vitest) the same way it loads via index.cjs's dynamic import() — mirrors project-registry.mjs.

import crypto from "node:crypto";

export function createAuthNonceGuard() {
  const pending = new Set();

  function mint() {
    const nonce = crypto.randomBytes(16).toString("hex");
    pending.add(nonce);
    return nonce;
  }

  // Single-use: a valid nonce is consumed (removed) the first time it's checked, whether the
  // check succeeds or is immediately retried — a second call with the same nonce always fails.
  function consume(nonce) {
    if (typeof nonce !== "string" || !pending.has(nonce)) return false;
    pending.delete(nonce);
    return true;
  }

  // Releases a nonce without requiring it to be "consumed" — called once its owning MCP call
  // settles (result or error), so nonces from tool calls that never touch authorizePath don't
  // linger indefinitely.
  function release(nonce) {
    if (typeof nonce === "string") pending.delete(nonce);
  }

  function size() {
    return pending.size;
  }

  return { mint, consume, release, size };
}
