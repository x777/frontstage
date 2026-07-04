"use strict";
// Dev convenience: boots the renderer's vite dev server in-process (vite's Node API — avoids a
// spawn(shell:true)-through-pnpm chain, which loses track of the real child on Windows), then
// launches Electron pointed at it. Packaged builds never touch this file (see `dist`/`dist:win`).
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createServer } = require("vite");
const electronPath = require("electron");

const APP_ROOT = path.join(__dirname, "..");

async function main() {
  const server = await createServer({
    configFile: path.join(APP_ROOT, "vite.renderer.config.ts"),
  });
  await server.listen();
  server.printUrls();

  const electronProc = spawn(electronPath, ["."], { stdio: "inherit", cwd: APP_ROOT });

  let shuttingDown = false;
  const shutdown = async (code) => {
    if (shuttingDown) return;
    shuttingDown = true;
    electronProc.kill();
    await server.close();
    // vite's HMR websocket/watchers can otherwise keep the event loop (and this process) alive.
    process.exit(code ?? 0);
  };

  electronProc.on("exit", (code) => { void shutdown(code ?? 0); });
  process.on("SIGINT", () => void shutdown(0));
  process.on("SIGTERM", () => void shutdown(0));
}

main().catch((err) => {
  console.error("[dev]", err);
  process.exitCode = 1;
});
