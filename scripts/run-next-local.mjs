#!/usr/bin/env node
/**
 * Start Next.js bound to loopback with a per-process local API token in env
 * (read by middleware and injected into the UI).
 */
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const nextBin = path.join(repoRoot, "node_modules/next/dist/bin/next");

const mode = process.argv[2];
if (mode !== "dev" && mode !== "start") {
  console.error("Usage: node scripts/run-next-local.mjs <dev|start>");
  process.exit(1);
}

// Match Next's .env loading so DEVFLOW_LOCAL_API_TOKEN in `.env` is visible here
// (Node does not load `.env` for this wrapper script on its own).
loadEnvConfig(repoRoot, mode === "dev");

const token =
  process.env.DEVFLOW_LOCAL_API_TOKEN?.trim() || crypto.randomBytes(32).toString("hex");

const child = spawn(process.execPath, [nextBin, mode, "-H", "127.0.0.1"], {
  cwd: repoRoot,
  stdio: "inherit",
  env: {
    ...process.env,
    DEVFLOW_LOCAL_API_TOKEN: token,
  },
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
