import "server-only";

import type { FlowCtx } from "../../shared/nodeSharedExports";
import type { FlowContextHelper } from "../../shared/runContext/flowContextHelper";
import type { AgentFactIntentOptions } from "./agentFactIntents";
import { localFactIntentOptions } from "./localFactIntentOptions";
import { diffFactUnchanged } from "./reusableDiff";

/**
 * The agent kind's fact-intent options in one seam: the local worktree
 * fallback for runs that reported no branches, plus the write-path reuse
 * guard that skips a diff capture whose persisted fact is still current.
 */
export const agentFactOptions = (
  ctx: FlowCtx,
  ctxHelper: FlowContextHelper,
  baseSha: string | null,
): AgentFactIntentOptions => ({
  ...localFactIntentOptions(ctx, ctxHelper),
  reuseUnchangedDiff: (branch) => diffFactUnchanged(ctx, ctxHelper, branch, baseSha),
});
