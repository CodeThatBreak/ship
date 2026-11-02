import "server-only";

import { branchStore } from "../kinds/build/branchStore";
import { flowCtxHelper, type FlowCtx } from "./runContext";
import { nodeSupport, type NodeSupport } from "./nodeSupport";

/** MR iid + git branch for pipeline, review, resolve and MR creation. */
export class MrTargetResolver {
  constructor(
    private readonly support: NodeSupport = nodeSupport,
    private readonly gitBranchOf = branchStore.gitBranch.bind(branchStore),
  ) {}

  resolve(
    ctx: FlowCtx,
    planBranchName?: string | null,
  ): { mrIid: number; mrBranch: string | null } {
    if (planBranchName) {
      const mrIid = this.support.branchMrIid(ctx.flow.id, planBranchName);
      if (!mrIid) {
        throw new Error(
          `no merge request for branch ${planBranchName} — create it first`,
        );
      }
      const persisted = this.gitBranchOf(ctx.flow.id, planBranchName);
      const mrBranch = persisted ?? flowCtxHelper.buildBranch(ctx, planBranchName);
      return { mrIid, mrBranch };
    }
    if (!ctx.flow.mr_iid) {
      throw new Error(
        "no merge request yet — approve the build to create one first",
      );
    }
    return { mrIid: ctx.flow.mr_iid, mrBranch: ctx.flow.mr_branch };
  }
}

export const mrTargetResolver = new MrTargetResolver();
