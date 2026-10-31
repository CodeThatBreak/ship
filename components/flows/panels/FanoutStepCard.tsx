"use client";
import Link from "next/link";
import {
  Check,
  CheckCircle2,
  CircleDashed,
  Clock,
  Coins,
  ExternalLink,
  GitMerge,
  Loader2,
  OctagonAlert,
  SkipForward,
  Undo2,
  X,
  type LucideIcon,
} from "lucide-react";
import type { PlanStepRow } from "@/types/flow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fmtDuration } from "@/lib/format";
import { FLOW_STATUS } from "@/constants/flow";

export type FanoutStepCardState = {
  label: string;
  className: string;
  icon: LucideIcon;
};

/** Per-step card state chip (plan fan-out §5). */
export const fanoutStepState = (s: PlanStepRow): FanoutStepCardState => {
  if (s.completed_by === "skipped")
    return { label: "skipped", className: "bg-zinc-500/10 text-zinc-400", icon: SkipForward };
  if (s.status === FLOW_STATUS.DONE)
    return { label: "merged", className: "bg-success/10 text-success", icon: CheckCircle2 };
  const ns = s.sub_flow?.nodeStatus ?? null;
  const ms = s.sub_flow?.mergeStatus ?? null;
  if (ms === "running") return { label: "merging", className: "bg-info/10 text-info", icon: GitMerge };
  if (ms === "conflict") {
    if (ns === FLOW_STATUS.RUNNING)
      return { label: "fixing", className: "bg-warning/10 text-warning", icon: Loader2 };
    return { label: "conflict", className: "bg-destructive/10 text-destructive", icon: GitMerge };
  }
  if (ms === "rejected")
    return {
      label: ns === FLOW_STATUS.RUNNING ? "fixing" : "push rejected",
      className: "bg-warning/10 text-warning",
      icon: ns === FLOW_STATUS.RUNNING ? Loader2 : OctagonAlert,
    };
  if (ns === FLOW_STATUS.FAILED)
    return { label: "failed", className: "bg-destructive/10 text-destructive", icon: OctagonAlert };
  if (ns === FLOW_STATUS.AWAITING_APPROVAL)
    return { label: "awaiting approval", className: "bg-warning/10 text-warning", icon: Clock };
  if (ns === FLOW_STATUS.RUNNING)
    return { label: "building", className: "bg-info/10 text-info", icon: Loader2 };
  return { label: "pending", className: "bg-zinc-500/10 text-zinc-400", icon: CircleDashed };
};

const StaleBaseChip = ({ s }: { s: PlanStepRow }) => {
  if (!s.sub_flow?.staleBase || s.status === FLOW_STATUS.DONE || s.completed_by === "skipped")
    return null;
  return (
    <Badge
      variant="outline"
      className="gap-1 text-[11px] shrink-0"
      title="This step branch was cut before an earlier sibling merged onto the integration branch — the merge will include (and resolve) that divergence; never rebased."
    >
      <GitMerge size={10} /> stale base
    </Badge>
  );
};

const StepCostChip = ({ s }: { s: PlanStepRow }) => {
  const runs = s.sub_flow?.runCount ?? 0;
  if (!runs) return null;
  const cents = s.sub_flow?.costCents ?? 0;
  const dur = s.sub_flow?.durationMs ?? 0;
  const tok = s.sub_flow?.tokens ?? 0;
  return (
    <Badge
      variant="outline"
      className="gap-1 font-mono text-[11px] shrink-0"
      title={`${runs} run${runs > 1 ? "s" : ""}${tok ? ` · ${tok >= 1000 ? `${Math.round(tok / 1000)}k tok` : `${tok} tok`}` : ""}`}
    >
      <Coins size={10} />
      {cents > 0 ? `$${(cents / 100).toFixed(2)}` : "cost n/a"}
      {dur > 0 && <span>· {fmtDuration(dur)}</span>}
    </Badge>
  );
};

export const FanoutStepCard = ({
  step,
  state,
  actionPending,
  approveBlocked,
  onApprove,
  onRetry,
  onSkip,
}: {
  step: PlanStepRow;
  state: FanoutStepCardState;
  actionPending: boolean;
  approveBlocked: boolean;
  onApprove: (stepId: string) => void;
  onRetry: (stepId: string) => void;
  onSkip: (stepId: string) => void;
}) => {
  const Icon = state.icon;
  const ms = step.sub_flow?.mergeStatus ?? null;
  const subFlow = step.sub_flow;

  return (
    <Card
      className="px-4 py-3 flex items-center gap-3 flex-wrap"
      title={subFlow?.mergeError ?? undefined}
    >
      <Badge className={state.className} variant={state.label === "failed" ? "destructive" : undefined}>
        <Icon
          size={11}
          className={cn(
            (state.label === "building" || state.label === "fixing" || state.label === "merging") &&
              "animate-spin",
          )}
        />
        {state.label}
      </Badge>
      <StaleBaseChip s={step} />
      <StepCostChip s={step} />
      <span className="min-w-0 flex-1">
        <span className="text-[13px] font-medium block truncate">{step.title}</span>
        {subFlow?.branch && (
          <span
            className="text-[11px] text-muted-foreground font-mono block truncate"
            title={
              subFlow.mergeError ? `${subFlow.branch} — ${subFlow.mergeError}` : subFlow.branch
            }
          >
            {subFlow.branch}
            {subFlow.mergeError && subFlow.nodeStatus !== FLOW_STATUS.RUNNING && (
              <span className="font-sans">
                {" "}
                ·{" "}
                {(subFlow.mergeStatus === "failed"
                  ? "merge failed: "
                  : ms === "conflict" || ms === "rejected"
                    ? "merge-fix: "
                    : "") + subFlow.mergeError.slice(0, 60)}
              </span>
            )}
          </span>
        )}
      </span>
      {subFlow?.nodeStatus === FLOW_STATUS.AWAITING_APPROVAL &&
        step.status !== FLOW_STATUS.DONE &&
        !approveBlocked && (
          <Button
            size="sm"
            className="gap-1"
            disabled={actionPending}
            onClick={() => onApprove(step.id)}
          >
            <Check size={12} /> Approve
          </Button>
        )}
      {subFlow?.nodeStatus === FLOW_STATUS.FAILED && step.status !== FLOW_STATUS.DONE && (
        <Button
          size="sm"
          variant="outline"
          className="gap-1"
          disabled={actionPending}
          onClick={() => onRetry(step.id)}
          title="Failed merge-backs re-run the merge (+ bounded fix agent); failed builds re-run the step build"
        >
          <Undo2 size={12} /> Retry
        </Button>
      )}
      {subFlow &&
        step.status !== FLOW_STATUS.DONE &&
        subFlow.nodeStatus !== FLOW_STATUS.RUNNING &&
        subFlow.nodeStatus !== FLOW_STATUS.AWAITING_APPROVAL && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            disabled={actionPending}
            onClick={() => onSkip(step.id)}
          >
            <X size={12} /> Skip
          </Button>
        )}
      {subFlow && (
        <Button
          size="sm"
          variant="outline"
          className="gap-1"
          render={<Link href={`/flows/${subFlow.id}`} />}
          title="Open the child flow screen (graph, run activity, chat, diff, approval)"
        >
          <ExternalLink size={12} /> Open sub-flow
        </Button>
      )}
    </Card>
  );
};
