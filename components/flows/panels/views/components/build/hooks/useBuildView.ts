"use client";

import type { FeedEvent } from "@/components/chat/timeline";
import type { FlowData, Node } from "@/types/flow";
import { FLOW_ACTION, FLOW_STATUS } from "@/constants/flow";
import { FLOW_EVENT_TYPE } from "@/constants/events";
import { ARTIFACT_KIND } from "../../../../artifacts/constants/artifactKinds";
import type { BuildViewModel } from "../types/buildViewModel";

/** All derived state behind the build footer and its tab contents. */
export function useBuildView(
  flow: FlowData,
  node: Node,
  action: (action: string, payload?: Record<string, unknown>) => void,
  events: FeedEvent[],
): BuildViewModel {
  const latest = node.artifacts.filter((artifact) => artifact.kind === ARTIFACT_KIND.DIFF).at(-1);
  const canApprove = node.status === FLOW_STATUS.AWAITING_APPROVAL;
  const branches = flow.branches ?? [];
  const hasBranches = branches.length > 1;

  const creatingMr = node.status === FLOW_STATUS.APPROVED && !hasBranches && !flow.mrUrl;
  const creatingMrBranches = new Set(
    hasBranches
      ? branches
          .filter((branch) =>
            (branch.status === FLOW_STATUS.APPROVED || branch.status === FLOW_STATUS.DONE) && !branch.mrUrl,
          )
          .map((branch) => branch.name)
      : [],
  );

  // Latest MR-creation failure per branch — cleared as soon as a newer
  // lifecycle/error event arrives (the engine only emits mr_failed for MR
  // creation failures, so anything newer means a retry is in flight).
  const mrErrorFor = (branch?: string): string | null => {
    for (let index = events.length - 1; index >= 0; index--) {
      const event = events[index];
      if (event.type === FLOW_EVENT_TYPE.MR_FAILED) {
        const branchName = event.data?.branchName;
        if (typeof branchName === "string" && branchName === branch) {
          return typeof event.message === "string" ? event.message : null;
        }
        continue;
      }
      if (event.type === FLOW_EVENT_TYPE.LIFECYCLE || event.type === FLOW_EVENT_TYPE.ERROR) return null;
    }
    return null;
  };

  const approveAll = () => action(FLOW_ACTION.APPROVE_BUILD);
  const approveBranch = (name: string) => action(FLOW_ACTION.APPROVE_BUILD, { branch: name });
  const singleErr = canApprove && !hasBranches ? mrErrorFor(undefined) : null;
  const allAwaiting =
    canApprove && hasBranches && branches.every((branch) => branch.status === FLOW_STATUS.AWAITING_APPROVAL);

  return {
    latest,
    canApprove,
    branches,
    hasBranches,
    creatingMr,
    creatingMrBranches,
    mrErrorFor,
    approveAll,
    approveBranch,
    singleErr,
    allAwaiting,
  };
}
