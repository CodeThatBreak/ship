import "server-only";

import type { DiffFile } from "../../../git/local";
import type { DiffAttribution } from "../constants/diffFactMeta";

/**
 * The typed fact vocabulary (design §4.1, Task 06): what a node can claim to
 * have established about the world. The vocabulary is a formalization over
 * the storage homes that already exist — the FactStore never creates a
 * parallel storage layer.
 */
export const FACT_KIND = {
  /** → branchStore row (the branch the run created and pushed) */
  BRANCH: "branch",
  /** → artifact kind "diff", meta {branch, stat} — the exact shape stepRollup writes */
  DIFF: "diff",
  /** → branch row mrIid/mrUrl, or the flow-level mrIid/mrUrl columns */
  CHANGE_REQUEST: "change_request",
} as const;
export type FactKind = (typeof FACT_KIND)[keyof typeof FACT_KIND];

/** The fact kinds an agent def may declare in `produces` — the git side
 *  effects a run's `result.git` may establish. `change_request` is
 *  deliberately NOT producible: MRs are established by the
 *  `create_change_request` verb (Phase 3), never directly by a run. */
export const PRODUCIBLE_FACTS = [FACT_KIND.BRANCH, FACT_KIND.DIFF] as const;
export type ProducibleFact = (typeof PRODUCIBLE_FACTS)[number];

/** A `branch` fact's payload — captured from the run result, persisted into the branch row. */
export interface BranchFactInput {
  name: string;
  gitBranch?: string | null;
  title?: string | null;
}

/** One projection of a diff capture (Task 08): the attribution names the
 *  range the raw/stat body covers — `agent` = `baseSha..head` (the run's own
 *  work), `all` = the branch's whole diff vs its base. */
export interface DiffProjection {
  attribution: DiffAttribution;
  stat: string;
  raw: string;
}

/** The shared body of a diff capture and a `diff` fact's payload (Task 08):
 *  the projections and the SHAs that anchor them. Fields stay optional so
 *  the test stand-ins that return the pre-Task-08 `{stat, raw}` shape keep
 *  typechecking — the real capture always populates them. */
export interface DiffCaptureBody {
  stat: string;
  raw: string;
  baseSha?: string | null;
  headSha?: string | null;
  attribution?: DiffAttribution;
  uncommitted?: true;
  alt?: DiffProjection;
}

/**
 * A `diff` fact's payload — `raw`/`stat` are captured from git BEFORE the
 * persistence batch (git I/O never joins a transaction, the stepRollup
 * precedent); the FactStore only writes what it is handed.
 */
export interface DiffFactInput extends DiffCaptureBody {
  branch: string;
}

/**
 * What `ctxHelper.makeDiff` returns: the capture body plus the parsed files
 * `diffBranch` produces. `branch` is the caller's argument, not the
 * capture's — the fact's payload joins them.
 */
export interface DiffCapture extends DiffCaptureBody {
  files: DiffFile[];
}

/** The makeDiff seam's payload (`agentFactIntents`' capture callback) — the
 *  capture minus the parsed files no fact consumer reads. */
export type DiffCapturePayload = DiffCaptureBody;

/** A `change_request` fact's payload — `branchName` set ⇒ the named branch
 *  row carries the MR; null ⇒ the flow-level MR columns do. */
export interface ChangeRequestFactInput {
  mrIid: number;
  mrUrl: string | null;
  branchName?: string | null;
}

/** A resolved `change_request` fact lookup (read model for resolvers and the flow context). */
export interface ChangeRequestFact {
  mrIid: number;
  mrUrl: string | null;
  branchName: string | null;
}