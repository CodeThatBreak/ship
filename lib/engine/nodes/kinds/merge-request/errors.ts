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

/** True when an error looks like a code/hook rejection rather than infra. */
export const isCommitError = (e: unknown): e is CommitError => e instanceof CommitError;

const HOOK_PATTERNS = [
  /pre-receive/i,
  /pre-push/i,
  /hook declined/i,
  /push declined/i,
  /rejected.*hook/i,
  /hook.*reject/i,
  /! \[remote rejected\]/i,
  /error: failed to push some refs/i,
];

/**
 * True when a push failure looks like a code/hook rejection rather than infra
 * (merge-request errors owns the signatures; the merge arena's Phase-2
 * classification reuses them verbatim so "repairable code state vs infra
 * failure" is decided the same way in both paths).
 */
export const isHookRejection = (text: string): boolean =>
  HOOK_PATTERNS.some((p) => p.test(text));

/** Distinguishes MR-creation failures from later pipeline/review failures. */
export class MrCreationFailed extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "MrCreationFailed";
  }
}

/** Map approve-build failures to a typed MR error only when the cause is known. */
export const toMrCreationFailure = (e: unknown): Error => {
  if (e instanceof MrCreationFailed) return e;
  if (e instanceof CommitError) return new MrCreationFailed(e.message, e);
  return e instanceof Error ? e : new Error(String(e));
};
