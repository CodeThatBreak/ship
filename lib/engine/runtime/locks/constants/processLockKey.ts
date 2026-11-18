import "server-only";

/**
 * The advisory-lock key that marks the single writer process (decision Q1's
 * single-writer default, made code — step 03). Arbitrary but FIXED: every
 * ProcessLock instance and the `/api/health` probe must agree on it forever;
 * changing it would let two workers hold "the" lock simultaneously.
 */
export const PROCESS_LOCK_KEY = 721_303;
