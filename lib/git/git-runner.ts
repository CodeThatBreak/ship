import "server-only";

import { execFile } from "child_process";
import { promisify } from "util";
import { processSingleton } from "../singleton";
import { GitCommandError } from "./git-errors";

const execFileAsync = promisify(execFile);

export const GIT_COMMAND_TIMEOUT_MS = 20_000;
export const GIT_FETCH_TIMEOUT_MS = 15_000;
export const GIT_WORKTREE_ADD_TIMEOUT_MS = 120_000;
export const MAX_GIT_BUFFER = 1024 * 1024 * 50;

export type GitRunOpts = {
  timeout?: number;
  maxBuffer?: number;
  env?: Record<string, string>;
  redactSecrets?: readonly string[];
};

/**
 * Bounded `git` exec: timeouts, buffer cap, and typed errors for callers.
 * All git subprocess I/O in DevFlow goes through this class.
 */
export class GitRunner {
  constructor(private readonly defaults: GitRunOpts = {}) {}

  async run(
    args: string[],
    opts: GitRunOpts = {},
  ): Promise<{ stdout: string; stderr: string }> {
    try {
      return await execFileAsync("git", args, {
        maxBuffer: opts.maxBuffer ?? this.defaults.maxBuffer ?? MAX_GIT_BUFFER,
        timeout: opts.timeout ?? this.defaults.timeout ?? GIT_COMMAND_TIMEOUT_MS,
        env: opts.env ? ({ ...process.env, ...opts.env } as NodeJS.ProcessEnv) : process.env,
      });
    } catch (e: unknown) {
      throw GitCommandError.fromExecError(args, e, opts.redactSecrets ?? []);
    }
  }
}

export const gitRunner = processSingleton("gitRunner", () => new GitRunner());
