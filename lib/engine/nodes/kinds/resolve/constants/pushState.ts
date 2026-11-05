import "server-only";

/**
 * The engine-verified push state of the resolve run's fix toward the remote MR
 * (§6A) — the resolution authority for `fixed` decisions (D1a) and the value
 * behind the loop edge condition. `unknown` is the verification error state of
 * §6 layer 3: it never resolves (never closes a thread on unverifiable facts).
 */
export const PUSH_STATE = {
  /** the MR head on the host holds the fix */
  PUSHED: "pushed",
  /** the agent committed locally but the remote branch does not have the commits */
  LOCAL_ONLY: "local_only",
  /** no code movement anywhere */
  NONE: "none",
  /** the MR state could not be verified — behaves as `none` for effects */
  UNKNOWN: "unknown",
} as const;
export type PushState = (typeof PUSH_STATE)[keyof typeof PUSH_STATE];
