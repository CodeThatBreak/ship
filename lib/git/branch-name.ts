import "server-only";

import { gitRunner } from "./git-runner";

export class InvalidBranchNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidBranchNameError";
  }
}

/** Fast shape guard before any git argv is built (sync callers). */
export const rejectInvalidBranchNameShape = (name: string): void => {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new InvalidBranchNameError("branch name must not be empty");
  }
  if (trimmed.startsWith("-")) {
    throw new InvalidBranchNameError(`branch name must not start with "-": ${trimmed}`);
  }
  if (trimmed.includes("\0")) {
    throw new InvalidBranchNameError("branch name must not contain NUL bytes");
  }
};

/**
 * Validate a branch/ref name with git before it reaches argv. Rejects leading
 * `-` and runs `git check-ref-format --branch`.
 */
export const assertValidBranchName = async (name: string): Promise<void> => {
  rejectInvalidBranchNameShape(name);
  try {
    await gitRunner.run(["check-ref-format", "--branch", name], { timeout: 5_000 });
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : String(e);
    throw new InvalidBranchNameError(`invalid branch name "${name}": ${detail}`);
  }
};
