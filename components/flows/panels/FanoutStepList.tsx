"use client";
import { useCallback } from "react";
import { Coins, GitMerge } from "lucide-react";
import type { FlowData, Node, PlanStepRow } from "@/types/flow";
import { useNodePanel } from "./context";
import { fmtDuration } from "@/lib/format";
import { FLOW_STATUS } from "@/constants/flow";
import { FanoutStepCard, fanoutStepState } from "./FanoutStepCard";

/**
 * The fan-out node's step cards (plan fan-out, Phase 1D): one card per plan
 * step with its child sub-flow state — state chip (pending / building /
 * awaiting approval / merged / failed / skipped), branch name, per-step cost
 * + duration (Phase 4), and the Approve · Retry · Skip · Open sub-flow
 * actions. A rollup line above the cards mirrors the node-card subtitle
 * (`N steps · M resolved · … · $X · total time`). Approve/Retry/Skip target
 * the child flow through the parent's action route; "Open sub-flow" links to
 * the child flow screen where the regular flow UI (graph, run activity, chat,
 * diff, approval) applies unchanged. Rendered inside a panel (build / agent
 * declarative) whenever the node fanned out — a no-op otherwise.
 */
export default function FanoutStepList({ flow }: { flow: FlowData; node?: Node }) {
  const { action, actionPending } = useNodePanel();
  const steps = (flow.planSteps ?? []).filter((s: PlanStepRow) => s.sub_flow != null);

  const onApprove = useCallback(
    (stepId: string) => action("approve_fanout_step", { stepId }),
    [action],
  );
  const onRetry = useCallback(
    (stepId: string) => action("retry_fanout_step", { stepId }),
    [action],
  );
  const onSkip = useCallback(
    (stepId: string) => action("skip_fanout_step", { stepId }),
    [action],
  );

  if (!steps.length) return null;

  // rollup (Phase 4): resolved/failed/in-flight counts + summed child cost &
  // duration — the node-level line matching the graph subtitle's rollup
  const resolved = steps.filter((s) => s.status === FLOW_STATUS.DONE).length;
  const failed = steps.filter(
    (s) => s.sub_flow?.nodeStatus === FLOW_STATUS.FAILED && s.status !== FLOW_STATUS.DONE,
  ).length;
  const inflight = steps.filter(
    (s) =>
      s.status !== FLOW_STATUS.DONE &&
      (s.sub_flow?.nodeStatus === FLOW_STATUS.RUNNING ||
        s.sub_flow?.nodeStatus === FLOW_STATUS.AWAITING_APPROVAL),
  ).length;
  const costCents = steps.reduce((sum, s) => sum + (s.sub_flow?.costCents ?? 0), 0);
  const durationMs = steps.reduce((sum, s) => sum + (s.sub_flow?.durationMs ?? 0), 0);
  const runs = steps.reduce((sum, s) => sum + (s.sub_flow?.runCount ?? 0), 0);

  return (
    <div className="mb-4">
      <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
        <GitMerge size={14} /> Step sub-flows
      </h3>
      {runs > 0 && (
        <div
          className="text-[11.5px] text-muted-foreground mb-2 flex items-center gap-1.5 flex-wrap"
          title={`${runs} run${runs > 1 ? "s" : ""} across ${steps.length} step sub-flow${steps.length > 1 ? "s" : ""}`}
        >
          <Coins size={11} />
          <span>
            {steps.length} step{steps.length > 1 ? "s" : ""} · {resolved} resolved
            {failed > 0 ? ` · ${failed} failed` : ""}
            {inflight > 0 ? ` · ${inflight} in flight` : ""}
          </span>
          <span>
            {costCents > 0 ? `$${(costCents / 100).toFixed(2)}` : "cost n/a"}
            {durationMs > 0 ? ` · ${fmtDuration(durationMs)}` : ""}
          </span>
        </div>
      )}
      <div className="grid gap-2">
        {steps.map((s) => {
          const ms = s.sub_flow?.mergeStatus ?? null;
          const approveBlocked =
            ms === "conflict" || ms === "rejected" || ms === "running" || ms === "failed";
          return (
            <FanoutStepCard
              key={s.id}
              step={s}
              state={fanoutStepState(s)}
              actionPending={actionPending}
              approveBlocked={approveBlocked}
              onApprove={onApprove}
              onRetry={onRetry}
              onSkip={onSkip}
            />
          );
        })}
      </div>
    </div>
  );
}
