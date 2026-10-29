'use client';
import { AlertTriangle, FileDiff, GitMerge } from 'lucide-react';
import type { BranchRow, Artifact, PlanStepRow } from '@/types/flow';
import PlanSteps from '../components/plan/components/planSteps/PlanSteps';
import DiffView from './DiffView';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { PanelShell, ArtifactLoader } from './shared';
import type { ArtifactPayload } from './shared';
import { useNodePanel } from './context';
import FanoutStepList from './FanoutStepList';
import { FLOW_STATUS, isFailedStatus, statusVariantOf } from '@/constants/flow';

/**
 * The build panel: the agent's diff per branch, the structured plan checklist
 * progress, and the accept-and-create-MR action. "approved" means the user
 * clicked and the background task is running: MR creation first, then the
 * pipeline gate — the build stage stays in this busy state until the MR
 * exists (the engine reverts to awaiting_approval with an mr_failed event if
 * MR creation fails).
 *
 * Plan fan-out (Phase 1D): when the node fanned out, the plan checklist is
 * replaced by the step cards (per-step monitor/approve/link to the child
 * flow screen) and the whole-plan diff only appears after the aggregate
 * approval's merges.
 */
export default function BuildView() {
  const { flow, node, action, events } = useNodePanel();
  const diffs = node.artifacts.filter((a: Artifact) => a.kind === 'diff');
  const latest = diffs[diffs.length - 1];
  const canApprove = node.status === FLOW_STATUS.AWAITING_APPROVAL;
  const branches = flow.branches ?? [];
  const hasBranches = branches.length > 1;
  const planSteps = flow.planSteps ?? [];
  const fannedOut = planSteps.some((s: PlanStepRow) => s.sub_flow != null);

  const creatingMr = node.status === FLOW_STATUS.APPROVED && !hasBranches && !flow.mr_url;
  const creatingMrBranches = new Set(
    hasBranches
      ? branches
          .filter((b: BranchRow) => (b.status === FLOW_STATUS.APPROVED || b.status === FLOW_STATUS.DONE) && !b.mr_url)
          .map((b: BranchRow) => b.name)
      : []
  );
  // latest MR-creation failure per branch — cleared as soon as a newer
  // lifecycle/error event arrives (the engine only emits mr_failed for MR
  // creation failures, so anything newer means a retry is in flight)
  const mrErrorFor = (branch?: string) => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type === 'mr_failed') {
        let b: string | undefined;
        try {
          b = e.data ? (JSON.parse(e.data).branchName ?? undefined) : undefined;
        } catch {
          /* ignore */
        }
        if (b === branch) return e.message as string;
        continue;
      }
      if (e.type === 'lifecycle' || e.type === 'error') return null;
    }
    return null;
  };

  const approveAll = () => action('approve_build');
  const approveBranch = (name: string) => action('approve_build', { branch: name });

  const singleErr = canApprove && !hasBranches ? mrErrorFor(undefined) : null;
  const allAwaiting =
    canApprove && hasBranches && branches.every((b: BranchRow) => b.status === FLOW_STATUS.AWAITING_APPROVAL);

  const footer = (
    <>
      <span className="text-xs text-muted-foreground">
        {canApprove
          ? (singleErr ??
            (hasBranches
              ? 'Review each diff, then create the merge requests.'
              : 'Review the diff, then create the merge request.'))
          : creatingMr || creatingMrBranches.size > 0
            ? 'Creating the merge request — the pipeline stage starts once the MR exists.'
            : flow.mr_url || hasBranches
              ? 'Merge request created.'
              : 'The diff appears here once the build finishes.'}
      </span>
      <div className="flex-1" />
      {canApprove && !hasBranches && (
        <Button onClick={approveAll}>
          <GitMerge size={14} /> {singleErr ? 'Retry: accept & create MR' : 'Accept & create MR'}
        </Button>
      )}
      {allAwaiting && (
        <Button onClick={approveAll}>
          <GitMerge size={14} /> Accept all & create MRs
        </Button>
      )}
    </>
  );

  return (
    <PanelShell node={node} action={action} flow={flow} runningLabel="Agent is implementing the plan…" footer={footer}>
      {/* structured plan progress — the build agent checks steps off as it reports them.
          Fanned out: the step cards replace the checklist (per-step state chips / actions). */}
      {fannedOut ? (
        <FanoutStepList flow={flow} node={node} action={action} />
      ) : (
        planSteps.length > 0 && (
          <PlanSteps steps={planSteps} editable={false} highlight flowId={flow.id} className="mb-4" />
        )
      )}
      {creatingMr && (
        <Alert variant="default" className="mb-3.5">
          <Spinner />
          <span className="flex-1 text-muted-foreground">
            Creating the merge request — the pipeline stage starts once the MR exists.
          </span>
        </Alert>
      )}
      {canApprove && !hasBranches && singleErr && (
        <Alert variant="destructive" className="mb-3.5">
          <AlertTriangle size={16} className="shrink-0" />
          <span className="flex-1">{singleErr}</span>
          <Button size="sm" onClick={approveAll}>
            <GitMerge size={13} /> Retry: accept & create MR
          </Button>
        </Alert>
      )}
      {/* per-branch build status + approval */}
      {hasBranches && (
        <div className="mb-4">
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
            <GitMerge size={14} /> Merge requests
          </h3>
          <div className="grid gap-2">
            {branches.map((b: BranchRow) => {
              const err = b.status === FLOW_STATUS.AWAITING_APPROVAL ? mrErrorFor(b.name) : null;
              return (
                <Card key={b.id} className="px-4 py-3 flex items-center gap-3 flex-wrap">
                  <Badge
                    className={statusVariantOf(b.status)}
                    variant={isFailedStatus(b.status) ? 'destructive' : undefined}
                  >
                    {b.status.replace(/_/g, ' ')}
                  </Badge>
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-sm">{b.title ?? b.name}</span>
                    <code className="text-xs text-muted-foreground ml-2">{b.name}</code>
                    {err && <div className="text-destructive text-xs mt-1">{err}</div>}
                  </div>
                  {b.mr_url && (
                    <a href={b.mr_url} target="_blank" className="text-info hover:underline text-xs">
                      MR !{b.mr_iid} ↗
                    </a>
                  )}
                  {creatingMrBranches.has(b.name) && (
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground text-xs">
                      <Spinner /> Creating MR…
                    </span>
                  )}
                  {b.status === FLOW_STATUS.AWAITING_APPROVAL && (
                    <Button size="sm" onClick={() => approveBranch(b.name)}>
                      <GitMerge size={13} /> {err ? 'Retry: accept & create MR' : 'Accept & create MR'}
                    </Button>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      )}
      {!hasBranches && flow.mr_url && (
        <p className="text-[13px]">
          <a href={flow.mr_url} target="_blank" className="text-info hover:underline">
            Open MR !{flow.mr_iid} ↗
          </a>{' '}
          on branch <code className="font-mono">{flow.mr_branch}</code>
        </p>
      )}
      {(latest || (!canApprove && node.status !== FLOW_STATUS.RUNNING)) && (
        <div>
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
            <FileDiff size={14} /> Changes
          </h3>
          {latest ? (
            <ArtifactLoader
              id={latest.id}
              render={(loaded: ArtifactPayload) => <DiffView raw={loaded.content} />}
            />
          ) : (
            <div className="text-center px-5 py-10">
              <GitMerge size={32} className="text-muted-foreground mb-3 mx-auto" />
              <p className="text-muted-foreground max-w-[380px] mx-auto">No changes yet.</p>
            </div>
          )}
        </div>
      )}
    </PanelShell>
  );
}
