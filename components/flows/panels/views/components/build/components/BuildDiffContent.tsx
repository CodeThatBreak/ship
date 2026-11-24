"use client";

import { AlertTriangle, FileDiff, GitMerge } from "lucide-react";
import type { FlowData } from "@/types/flow";
import { FLOW_STATUS } from "@/constants/flow";
import { EmptyHint } from "@/components/shared/EmptyHint";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ArtifactLoader } from "../../../../artifacts/components/ArtifactLoader";
import { DiffView } from "../../../../artifacts/components/DiffView";
import type { ArtifactPayload } from "../../../../artifacts/types/artifactPayload";
import type { PanelActionFn } from "../../../../artifacts/types/artifactRenderer";
import type { BuildViewModel } from "../types/buildViewModel";
import { BuildBranchRow } from "./BuildBranchRow";

/** MR-creation status, branch approvals and the latest code diff. */
export function BuildDiffContent({
  flow,
  action,
  model,
}: {
  flow: FlowData;
  action: PanelActionFn;
  model: BuildViewModel;
}) {
  return (
    <>
      {model.creatingMr && (
        <Alert variant="default" className="mb-3.5">
          <Spinner />
          <span className="flex-1 text-muted-foreground">
            Creating the merge request — the pipeline stage starts once the MR exists.
          </span>
        </Alert>
      )}
      {model.canApprove && !model.hasBranches && model.singleErr && (
        <Alert variant="destructive" className="mb-3.5">
          <AlertTriangle size={16} className="shrink-0" />
          <span className="flex-1">{model.singleErr}</span>
          <Button size="sm" onClick={model.approveAll}>
            <GitMerge size={13} /> Retry: accept & create MR
          </Button>
        </Alert>
      )}
      {model.hasBranches && (
        <div className="mb-4">
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
            <GitMerge size={14} /> Merge requests
          </h3>
          <div className="grid gap-2">
            {model.branches.map((branch) => (
              <BuildBranchRow
                key={branch.id}
                branch={branch}
                error={branch.status === FLOW_STATUS.AWAITING_APPROVAL ? model.mrErrorFor(branch.name) : null}
                creatingMr={model.creatingMrBranches.has(branch.name)}
                awaitingApproval={branch.status === FLOW_STATUS.AWAITING_APPROVAL}
                onApprove={model.approveBranch}
              />
            ))}
          </div>
        </div>
      )}
      {!model.hasBranches && flow.mrUrl && (
        <p className="text-[13px]">
          <a href={flow.mrUrl} target="_blank" rel="noopener noreferrer" className="text-info hover:underline">
            Open MR !{flow.mrIid} ↗
          </a>{" "}
          on branch <code className="font-mono">{flow.mrBranch}</code>
        </p>
      )}
      <div>
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
          <FileDiff size={14} /> Changes
        </h3>
        {model.latest ? (
          <ArtifactLoader
            id={model.latest.id}
            render={(loaded: ArtifactPayload) => <DiffView artifact={loaded} action={action} />}
          />
        ) : (
          <EmptyHint icon={GitMerge}>No changes yet.</EmptyHint>
        )}
      </div>
    </>
  );
}
