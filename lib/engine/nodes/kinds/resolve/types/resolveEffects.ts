import "server-only";

/**
 * The resolve effects vocabulary (§4): the idempotency journal, the planned
 * effect list, and the application input/counts. Behavior (the fostering of
 * both) lives in `resolveEffects.ts` — the types here are what the planner,
 * the applier, the artifact meta, and the run output share.
 */
import type { CommentRow } from "../../../../../db/rows";
import type { PushState } from "../constants/pushState";
import type { ResolveAgentResponse, ResolveCommentDecision } from "../schema";

/** Idempotency journal (§4) — persisted into the resolve artifact meta after every effect. */
export type ResolveEffectLedger = {
  /** replies verified as posted on the host, keyed by content hash */
  replies: { hash: string; noteId: string }[];
  /** discussions verified as resolved on the host */
  resolvedDiscussions: string[];
};

/** Counts of the effects performed by ONE application (ledgered effects are skipped, not recounted). */
export type ResolveEffectCounts = {
  /** threads closed in this application (host-resolved + local-only closes) */
  resolved: number;
  /** replies posted this application */
  replied: number;
  /** decisions of action wontfix this application */
  wontfix: number;
  /** decisions of action skipped + `fixed` decisions degraded for missing push authority (§3) */
  skipped: number;
  /** host effects that failed after bounded retry */
  hostFailures: number;
};

export type ResolveEffectResult = ResolveEffectCounts & { ledger: ResolveEffectLedger };

/** One planned host/local action, in application order (replies precede their thread's resolve). */
export type ResolvePlannedEffect =
  | { kind: "reply"; threadId: string; body: string; commentId: string }
  | { kind: "resolve"; threadId: string; rowIds: string[] }
  | { kind: "localClose"; rowIds: string[]; commentId: string };

export type ResolvePlan = {
  effects: ResolvePlannedEffect[];
  /** `fixed + resolve` rows degraded to skipped: the fix is unverifiable and the agent did not explain (§3). */
  degradedSkips: ResolveCommentDecision[];
  /** warning lines emitted as feed events when the plan degrades a decision */
  warnings: string[];
};

/** Injected retry-clock seam for the bounded host retry (G5) — tests pass a recorded no-op. */
export type HostRetrySleep = (ms: number) => Promise<void>;

export type ResolveEffectInput = {
  flowId: string;
  nodeId: string;
  repoUrl: string;
  mrIid: number;
  /** the validated agent response (the contract guarantees decision coverage) */
  response: ResolveAgentResponse;
  /** the presented open comment rows, keyed by id */
  open: readonly CommentRow[];
  /** engine-verified push state of the fix (§6A) */
  pushState: PushState;
  /** the previous application's ledger, read from the artifact meta */
  ledger: ResolveEffectLedger;
  /** called after every landed effect — persists the ledger into the artifact meta */
  persistProgress: (ledger: ResolveEffectLedger) => void;
};
