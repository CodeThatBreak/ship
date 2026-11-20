import "server-only";

/**
 * MR-creation failure that an agent can plausibly fix in the build step —
 * a rejected push (pre-push/pre-receive hooks, type checks, lint gates).
 * Network/auth/API failures are thrown as plain Errors (manual retry).
 */
export class CommitError extends Error {
  constructor(
    message: string,
    readonly detail: string,
  ) {
    super(message);
    this.name = "CommitError";
  }
}

/** Distinguishes MR-creation failures from later pipeline/review failures. */
export class MrCreationFailed extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "MrCreationFailed";
  }
}
