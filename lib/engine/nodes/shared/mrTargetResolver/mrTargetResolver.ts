import "server-only";

import { branchStore } from "../../kinds/build/branchStore";
import { flowCtxHelper } from "../runContext";
import type { FlowCtx } from "../runContext/types/flowContext";
import type { NodeSupport } from "../nodeSupport";
import { nodeSupport } from "@/lib/composition/container";

/**
 * MR iid + git branch for pipeline, review, resolve and MR creation.
 * Sources: the named plan branch's MR when one is targeted; otherwise the
 * flow MR, then the most recent branch row with an MR (the change_request
 * fact fallback).
 */
export class MrTargetResolver {
  constructor(
    private readonly support: NodeSupport = nodeSupport,
    private readonly gitBranchOf = branchStore.gitBranch.bind(branchStore),
    private readonly latestBranchMrOf = branchStore.latestWithMr.bind(branchStore),
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
    if (ctx.flow.mrIid) {
      return { mrIid: ctx.flow.mrIid, mrBranch: ctx.flow.mrBranch };
    }
    const latest = await this.latestBranchMrOf(ctx.flow.id);
    if (!latest) {
      throw new Error(
        "no merge request yet — approve the build to create one first",
      );
    }
    const mrBranch = latest.gitBranch ?? flowCtxHelper.buildBranch(ctx, latest.name);
    return { mrIid: latest.mrIid, mrBranch };
  }
}

