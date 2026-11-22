import "server-only";

import { localGit } from "../../../../git/local";
import { RUN_MODE } from "@/constants/execution";
import type { FlowCtx } from "../../shared/nodeSharedExports";
import type { FlowContextHelper } from "../../shared/runContext/flowContextHelper";
import type { AgentFactIntentOptions } from "./agentFactIntents";

/**
 * Binds the local-mode branch fallback for `agentFactIntents`: cloud runs
 * report their branches through the SDK and need no git read; a local run that
 * committed but never pushed does not, so the engine reads the worktree HEAD
 * (the BuildNode local-result precedent). The resolver is lazy — it runs only
 * when a fact kind is declared and no branch was self-reported.
 */
export const localFactIntentOptions = (ctx: FlowCtx, ctxHelper: FlowContextHelper): AgentFactIntentOptions => ({
  resolveLocalBranch: async () => {
    if (ctxHelper.execMode(ctx) !== RUN_MODE.LOCAL) return null;
    return (await localGit.currentBranch(ctxHelper.requireRunCwd(ctx)).catch(() => null)) ?? null;
  },
});
