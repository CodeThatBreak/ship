import "server-only";

import { CommitError, MrCreationFailed } from "../errors";

/** Map approve-build failures to a typed MR error only when the cause is known. */
export const toMrCreationFailure = (e: unknown): Error => {
  if (e instanceof MrCreationFailed) return e;
  if (e instanceof CommitError) return new MrCreationFailed(e.message, e);
  return e instanceof Error ? e : new Error(String(e));
};
