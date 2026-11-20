import { CommitError } from "../errors";

/** True when an error looks like a code/hook rejection rather than infra. */
export const isCommitError = (e: unknown): e is CommitError => e instanceof CommitError;
