#!/usr/bin/env node
// Composes the Cloudflare Pages deploy directory:
//   deploy/            <- site/* (the landing page) verbatim
//   deploy/studio/      <- apps/web's production build (relay mode, base "/studio/")
//   deploy/_headers     <- the COOP/COEP block for /studio/*, merged once at the deploy root
//
// Usage: node scripts/build-site.mjs

import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import { spawnSync } from "node:child_process";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const siteDir = path.join(repoRoot, "site");
const webDir = path.join(repoRoot, "apps", "web");
const webDistDir = path.join(webDir, "dist");
const deployDir = path.join(repoRoot, "deploy");
const deployStudioDir = path.join(deployDir, "studio");

// The COOP/COEP block that apps/web/public/_headers also carries (for the local vite dev/preview
// server and self-host deploys). Vite copies public/_headers into dist/_headers verbatim, but that
// copy is scoped to a "/studio/*" path that only makes sense at the Pages deploy ROOT — a _headers
// file living inside deploy/studio/ is invisible to Cloudflare Pages (it only reads the one at the
// build output root). So: one copy, written directly at deploy/, and the one vite drops into
// dist/_headers is discarded after the copy to avoid a dead duplicate.
const HEADERS_BLOCK = `/studio/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
`;

async function rmrf(target) {
  await fs.rm(target, { recursive: true, force: true });
}

function runWebBuild() {
  const isWin = process.platform === "win32";
  const pnpmCmd = isWin ? "pnpm.cmd" : "pnpm";
  const result = spawnSync(pnpmCmd, ["-F", "@frontstage/web", "build"], {
    cwd: repoRoot,
    env: { ...process.env, VITE_RELAY_MODE: "1" },
    stdio: "inherit",
    shell: true,
  });
  if (result.status !== 0) {
    throw new Error(`web build failed (exit ${result.status ?? "signal " + result.signal})`);
  }
}

async function main() {
  await rmrf(deployDir);
  await fs.mkdir(deployDir, { recursive: true });

  // 1. site/* -> deploy/ (the landing page, at root)
  await fs.cp(siteDir, deployDir, { recursive: true });

  // 2. apps/web build (relay mode) -> deploy/studio/
  runWebBuild();
  if (!fsSync.existsSync(webDistDir)) {
    throw new Error(`expected build output at ${webDistDir}, found nothing`);
  }
  await fs.cp(webDistDir, deployStudioDir, { recursive: true });

  // Drop vite's copy of public/_headers from inside deploy/studio/ — Pages only reads the deploy
  // root's _headers, so a nested copy is a dead duplicate that could also drift from the merged one.
  await rmrf(path.join(deployStudioDir, "_headers"));

  // 3. One merged _headers at the deploy root, covering /studio/*
  await fs.writeFile(path.join(deployDir, "_headers"), HEADERS_BLOCK);

  console.log(`deploy/ written to ${deployDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
