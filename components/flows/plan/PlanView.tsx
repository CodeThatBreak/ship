"use client";
import { useMemo, useState } from "react";
import type { Artifact, FlowData, Node } from "@/types/flow";
import PlanSteps from "./PlanSteps";
import { registerPanel } from "../panels/registry";
import { VersionTabs } from "../panels/shared";
import { computeScopedDiff, computeStaleBranches } from "./branch-diff";
import { PLAN_ACTION, type ExecutionMode } from "./constants";
import { executionLabel, resolveExecution } from "./plan-execution";
import { useExecutionPick } from "./hooks/use-execution-pick";
import { PlanPanelHeader } from "./PlanPanelHeader";
import { PlanFailureAlert } from "./PlanFailureAlert";
import { PlanEmptyHint } from "./PlanEmptyHint";
import { PlanRunningState } from "./PlanRunningState";
import { MainPlanSection } from "./MainPlanSection";
import { BranchPlanSection } from "./BranchPlanSection";
import { PlanApproveFooter } from "./PlanApproveFooter";
import { planComposerBus } from "./hooks/composer-bus";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { BranchPlan, FlowAction } from "./types";
import { FLOW_STATUS } from "@/constants/flow";

/**
 * The plan node's panel container: composes the extracted presentational
 * subcomponents (components/flows/plan/*) with the execution-resolution state
 * and the plan fan-out actions (§1, §7.1). The plan's runs and refinements
 * are composer-driven (docs/plan-conversation-refine.md §4) — the header's
 * refine button focuses the conversation composer and a branch card's Refine
 * prefills the scoped body, both dispatched through the plan composer bus.
 */
export default function PlanView({
  flow,
  node,
  action,
  fetchArtifact,
}: {
  flow: FlowData;
  node: Node;
  action: FlowAction;
  fetchArtifact: (id: string) => Promise<unknown>;
}) {
  const plans = node.artifacts.filter((a: Artifact) => a.kind === "plan");
  const [sel, setSel] = useState<string | null>(null);
  const [openBranchTab, setOpenBranchTab] = useState<string | null>(null);
  const current = plans.find((a) => a.id === sel) ?? plans[plans.length - 1];
  const awaiting = node.status === FLOW_STATUS.AWAITING_APPROVAL;
  const running = node.status === FLOW_STATUS.RUNNING;
  const isCurrent = Boolean(current && current.id === plans[plans.length - 1]?.id);

  // Phase 3A: extract branches from the plan output or artifact meta
  const branches = (node.output?.branches ?? null) as BranchPlan[] | null;
  // structured checklist (live rows; editable until the plan is approved)
  const planSteps = flow.planSteps ?? [];
  const showChecklist =
    planSteps.length > 0 || awaiting || node.status === FLOW_STATUS.APPROVED;

  const execution = resolveExecution(node, current?.meta);
  const [execPick, setExecPick] = useExecutionPick(
    execution.resolution,
    `${current?.id ?? ""}:${execution.resolution}`,
  );

  // scoped-refine diff banner data (§6/§7.3), computed client-side from the
  // two artifact versions' steps — no server diff endpoint needed.
  const scopedDiff = useMemo(() => computeScopedDiff(plans), [plans]);
  // staleness (§8): a scoped refine makes its branch doc newer than the overview
  const staleBranches = useMemo(
    () => computeStaleBranches(plans, branches, current?.version ?? 0),
    [branches, plans, current?.version],
  );

  const toggleBranch = (name: string) =>
    setOpenBranchTab((tab) => (tab === name ? null : name));
  // branch-scoped sub-plan refine (§7.1, now §4c): prefill the composer with
  // the scoped body — the collapse of the branch tab happens with it
  const refineBranchAt = (name: string) => {
    setOpenBranchTab(null);
    planComposerBus.prefillBranch(name);
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <PlanPanelHeader node={node} onRefine={() => planComposerBus.focusComposer()} />

      {/* scrollable content */}
      <ScrollArea className="flex-1">
        <div className="px-5 py-4 flex flex-col gap-4">
          {node.status === FLOW_STATUS.FAILED && (
            <PlanFailureAlert
              onRetry={() => action(PLAN_ACTION.RETRY, { nodeKey: node.node_key })}
            />
          )}

          {plans.length === 0 && node.status === FLOW_STATUS.PENDING && <PlanEmptyHint />}

          {running && (
            <PlanRunningState
              hasPlans={plans.length > 0}
              onStop={() => action(PLAN_ACTION.CANCEL, { nodeKey: node.node_key })}
            />
          )}

          {plans.length > 1 && (
            <VersionTabs arts={plans} sel={current?.id} onSel={setSel} />
          )}

          {/* ── main plan (level 1) — always on top, never hidden by an open sub-plan ── */}
          {current && (
            <MainPlanSection planId={current.id} fetchArtifact={fetchArtifact} />
          )}

          {/* ── sub-plans (level 2) — indented under the main plan to show hierarchy ── */}
          {branches && branches.length > 0 && (
            <BranchPlanSection
              branches={branches}
              staleBranches={staleBranches}
              scopedDiff={scopedDiff}
              expandedTab={openBranchTab}
              canRefine={awaiting && isCurrent}
              onToggle={toggleBranch}
              onRefine={refineBranchAt}
            />
          )}

          {/* structured editable checklist — the machine-readable plan steps, at the bottom */}
          {showChecklist && (
            <PlanSteps
              steps={planSteps}
              editable={awaiting}
              action={action}
            />
          )}
        </div>
      </ScrollArea>

      {/* fixed footer */}
      {awaiting && isCurrent && (
        <PlanApproveFooter
          pick={execPick}
          onPick={setExecPick}
          note={executionLabel(
            execution.resolution,
            branches && branches.length ? branches.length : planSteps.length,
          )}
          publishedSource={execution.publishedSource}
          plannerRationale={execution.plannerRationale}
          knob={execution.knob}
          stepCount={branches && branches.length ? branches.length : planSteps.length}
          onApprove={(pick: ExecutionMode) =>
            action(PLAN_ACTION.APPROVE, {
              ...(pick !== execution.published ? { executionOverride: pick } : {}),
            })
          }
        />
      )}
    </div>
  );
}

// registered with the panel registry (§3.1) — served by the builtin plan key
registerPanel({ type: "plan" }, PlanView);
