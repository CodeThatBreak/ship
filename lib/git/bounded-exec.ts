import "server-only";

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export const GIT_COMMAND_TIMEOUT_MS = 20_000;
export const GIT_FETCH_TIMEOUT_MS = 15_000;
const MAX_BUFFER = 1024 * 1024 * 50;

/** Run git with bounded time and buffer (never block the engine on a stalled remote). */
export const runGit = (
  args: string[],
  opts: { timeout?: number; maxBuffer?: number } = {},
): Promise<{ stdout: string; stderr: string }> =>
  execFileAsync("git", args, {
    maxBuffer: opts.maxBuffer ?? MAX_BUFFER,
    timeout: opts.timeout ?? GIT_COMMAND_TIMEOUT_MS,
  });
