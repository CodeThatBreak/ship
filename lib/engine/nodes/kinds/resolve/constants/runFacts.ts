import "server-only";

/**
 * The resolve run's persisted facts: the artifact kind every resolve run
 * publishes (its idempotency ledger rides the artifact meta), the bounded
 * MR-head recheck window, and the ledger a run starts from.
 */
import type { ResolveEffectLedger } from "../types/resolveEffects";

/** The artifact kind every resolve run publishes — the recovery ledger's home. */
export const RESOLVE_ARTIFACT_KIND = "resolve";

/** One bounded MR-head recheck: guards a push landing just after the run. */
export const RECHECK_MS = 5_000;

/** The ledger a run starts from — empty unless restart recovery read one. */
export const EMPTY_LEDGER: ResolveEffectLedger = { replies: [], resolvedDiscussions: [] };
