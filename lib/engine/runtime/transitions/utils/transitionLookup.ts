import "server-only";

import { NODE_STATUS, type EngineNodeStatus } from "../../../constants/nodeStatus";
import type { TransitionKey, TransitionRow } from "../types/transitions";
import { TRANSITION_TABLE } from "../constants/transitionTable";

/**
 * Pure lookups over the declared transition table — the vocabulary check
 * every authority write funnels through, extracted so `transitionTable.test.ts`
 * can assert the table without a database.
 */

/** The declared row for a key — throws when the key is not in the table. */
export function transitionRow(key: TransitionKey): TransitionRow {
  return TRANSITION_TABLE[key];
}

/** True when `from → to` is a declared pair for the key. */
export function isDeclaredPair(key: TransitionKey, from: EngineNodeStatus, to: EngineNodeStatus): boolean {
  const row: TransitionRow = TRANSITION_TABLE[key];
  return row.from.includes(from) && row.to.includes(to);
}

/**
 * Resolve the concrete target status for a keyed transition: `toStatus` when
 * the caller carries one (multi-target rows like `chatRevert`), else the row's
 * single declared target. Throws (loud, never a default) when the requested
 * target is not in the row's to-set — an undeclared pair must fail, not guess.
 */
export function resolveToStatus(key: TransitionKey, toStatus?: EngineNodeStatus): EngineNodeStatus {
  const row: TransitionRow = TRANSITION_TABLE[key];
  if (toStatus == null) {
    if (row.to.length !== 1) {
      throw new Error(`transition "${key}" has several declared targets — pass toStatus`);
    }
    return row.to[0];
  }
  if (!row.to.includes(toStatus)) {
    throw new Error(`transition "${key}" cannot target "${toStatus}" (declared: ${row.to.join("/")})`);
  }
  return toStatus;
}

/**
 * Narrow an untyped target string (a recorded pre-claim status, a plan retry
 * revert target) to a declared one — the loud, cast-free boundary for callers
 * whose target arrives as data rather than a literal.
 */
export function toStatusOf(key: TransitionKey, toStatus: string): EngineNodeStatus {
  const row: TransitionRow = TRANSITION_TABLE[key];
  const match = row.to.find((t) => t === toStatus);
  if (match == null) {
    throw new Error(`transition "${key}" cannot target "${toStatus}" (declared: ${row.to.join("/")})`);
  }
  return match;
}

/** Placeholder SQL parameter list builder: `$6,$7,…` for IN (…) sets. */
export function sqlMarks(from: readonly EngineNodeStatus[], offset: number): string {
  return from.map((_, i) => `$${offset + i}`).join(",");
}

/** Claims are the only rows that move a node INTO `running`. */
export function isClaimKey(key: TransitionKey): boolean {
  const row: TransitionRow = TRANSITION_TABLE[key];
  return row.to.includes(NODE_STATUS.RUNNING);
}

/** Whether an untyped status read sits in a row's from-set — the loud
 *  boundary for fence pre-checks on data-shaped statuses (the caller still
 *  claims through the authority; the read only selects). */
export function isInFromSet(key: TransitionKey, status: string): boolean {
  return TRANSITION_TABLE[key].from.some((member) => member === status);
}
