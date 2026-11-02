import "server-only";

import { gitRunner, GIT_COMMAND_TIMEOUT_MS, GIT_FETCH_TIMEOUT_MS } from "./gitRunner";

export { GIT_COMMAND_TIMEOUT_MS, GIT_FETCH_TIMEOUT_MS };

/** Run git with bounded time and buffer (never block the engine on a stalled remote). */
export const runGit = (
  args: string[],
  opts: { timeout?: number; maxBuffer?: number } = {},
): Promise<{ stdout: string; stderr: string }> => gitRunner.run(args, opts);
