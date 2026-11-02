import "server-only";

import { redactGitSecrets } from "./redactGitSecrets";

export class GitCommandError extends Error {
  constructor(
    message: string,
    readonly args: readonly string[],
    readonly killed = false,
    readonly stderr = "",
  ) {
    super(message);
    this.name = "GitCommandError";
  }

  static fromExecError(
    args: readonly string[],
    e: unknown,
    redactSecrets: readonly string[] = [],
  ): GitCommandError {
    const err = (typeof e === "object" && e !== null ? e : {}) as {
      killed?: boolean;
      stderr?: unknown;
      message?: unknown;
    };
    const stderr = redactGitSecrets(String(err.stderr ?? "").trim(), redactSecrets);
    const killed = !!err.killed;
    const tail = stderr.slice(-500);
    const cmd = redactGitSecrets(`git ${args.join(" ")}`, redactSecrets);
    const rawMsg = redactGitSecrets(String(err.message ?? e), redactSecrets);
    const base = killed ? `${cmd} timed out` : `${cmd} failed (${rawMsg})`;
    return new GitCommandError(tail ? `${base} — ${tail}` : base, args, killed, stderr);
  }
}

export class BaseRefNotFoundError extends Error {
  constructor(
    readonly configuredBranch: string,
    readonly tried: readonly string[],
  ) {
    super(
      `could not resolve base ref for branch "${configuredBranch}" (tried: ${tried.join(", ")})`,
    );
    this.name = "BaseRefNotFoundError";
  }
}

export class AuthedUrlResolutionError extends Error {
  constructor(readonly repoUrl: string, cause?: unknown) {
    const detail = cause instanceof Error ? cause.message : cause != null ? String(cause) : "unknown error";
    super(`could not resolve authenticated git URL for "${repoUrl}": ${detail}`);
    this.name = "AuthedUrlResolutionError";
  }
}
