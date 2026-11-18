import "server-only";

import { branchStore } from "../kinds/build/branchStore";
import { flowCtxHelper, type FlowCtx } from "./runContext";
import type { NodeSupport } from "./nodeSupport";
import { nodeSupport } from "@/lib/composition/container";

/** MR iid + git branch for pipeline, review, resolve and MR creation. */
export class MrTargetResolver {
  constructor(
    private readonly support: NodeSupport = nodeSupport,
    private readonly gitBranchOf = branchStore.gitBranch.bind(branchStore),
  ) {}

  async resolve(
    ctx: FlowCtx,
    planBranchName?: string | null,
  ): Promise<{ mrIid: number; mrBranch: string | null }> {
    if (planBranchName) {
      const mrIid = await this.support.branchMrIid(ctx.flow.id, planBranchName);
      if (!mrIid) {
        throw new Error(
          `no merge request for branch ${planBranchName} — create it first`,
        );
      }
      const persisted = await this.gitBranchOf(ctx.flow.id, planBranchName);
      const mrBranch = persisted ?? flowCtxHelper.buildBranch(ctx, planBranchName);
      return { mrIid, mrBranch };
    }
    if (!ctx.flow.mrIid) {
      throw new Error(
        "no merge request yet — approve the build to create one first",
      );
    }
    return { mrIid: ctx.flow.mrIid, mrBranch: ctx.flow.mrBranch };
  }
}

export const mrTargetResolver = new MrTargetResolver();
