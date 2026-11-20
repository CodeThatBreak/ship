import "server-only";

/**
 * The finalize/recovery contracts between the resolve def and its finisher
 * (`ResolveFinisher`): the pre-run state capture and everything the §6
 * pipeline needs around the agent result. Behavior lives in the finisher —
 * these are the shared shapes only.
 */
import type { NodeRow, CommentRow } from "../../../../../db/rows";
import type { mcpSourcesOf } from "../../../../templates/nodeConfig";

/** MR head + local branch fingerprint before a run (null when unusable). */
export interface CapturedState {
  mrSha: string | null;
  localRef: string | null;
}

/** Everything finalize (and restart recovery) needs around the agent result. */
export interface FinishParams {
  node: NodeRow;
  repoUrl: string;
  mrIid: number;
  mrBranch: string | null;
  /** the open rows whose ids the prompt presented — the contract coverage set */
  open: readonly CommentRow[];
  /** pre-run verified state; null on restart recovery (no baseline exists) */
  before: CapturedState | null;
  worktree: string | null;
  label: string;
  model: string | null;
  settingSources: ReturnType<typeof mcpSourcesOf>;
  /** restart recovery mode: no baseline verify, ledger picked up from the artifact */
  restart: boolean;
}
