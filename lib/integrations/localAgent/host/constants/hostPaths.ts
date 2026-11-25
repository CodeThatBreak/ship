import "server-only";

import path from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root — the working directory the host child is spawned in. */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");

/** The host entry point (run with `tsx`, which the repo already depends on). */
export const HOST_ENTRY = path.join(REPO_ROOT, "worker/localAgentHost.ts");

/** `tsx` binary — the host is TypeScript, and the repo ships tsx for the worker. */
export const HOST_TSX_BIN = path.join(REPO_ROOT, "node_modules/.bin/tsx");

/** The worker tsconfig maps `server-only` to a stub and `@/*` to the repo root. */
export const HOST_TSCONFIG = path.join(REPO_ROOT, "worker/tsconfig.json");

/**
 * How long a start/stream call may wait on the host before it counts as a hang.
 * Deliberately longer than the run timeout the service enforces, so the
 * service's typed AgentRunTimeoutError is what callers see.
 */
export const HOST_CALL_TIMEOUT_MS = 35 * 60 * 1000;
