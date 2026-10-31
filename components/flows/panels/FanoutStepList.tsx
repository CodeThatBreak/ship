"use client";
import { Check, CheckCircle2, CircleDashed, Clock, Coins, ExternalLink, GitMerge, Loader2, OctagonAlert, SkipForward, Undo2, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { FlowData, Node, PlanStepRow } from "@/types/flow";
import { useNodePanel } from "./context";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fmtDuration } from "@/lib/format";
import { FLOW_STATUS } from "@/constants/flow";

/** Per-step card state chip (plan fan-out §5) — Phase 2 adds the merge-back
 *  states (merging / conflict / fixing) read off the durable `step_merges` row. */
function stepState(s: PlanStepRow): { label: string; className: string; icon: LucideIcon } {
  if (s.completed_by === "skipped") return { label: "skipped", className: "bg-zinc-500/10 text-zinc-400", icon: SkipForward };
  if (s.status === FLOW_STATUS.DONE) return { label: "merged", className: "bg-success/10 text-success", icon: CheckCircle2 };
  const ns = s.sub_flow?.nodeStatus ?? null;
  const ms = s.sub_flow?.mergeStatus ?? null;
  if (ms === "running") return { label: "merging", className: "bg-info/10 text-info", icon: GitMerge };
  if (ms === "conflict") {
    // the bounded merge-fix agent runs on the child while it repairs → "fixing"
    if (ns === FLOW_STATUS.RUNNING) return { label: "fixing", className: "bg-warning/10 text-warning", icon: Loader2 };
    return { label: "conflict", className: "bg-destructive/10 text-destructive", icon: GitMerge };
  }
  if (ms === "rejected") return { label: ns === FLOW_STATUS.RUNNING ? "fixing" : "push rejected", className: "bg-warning/10 text-warning", icon: ns === FLOW_STATUS.RUNNING ? Loader2 : OctagonAlert };
  if (ns === FLOW_STATUS.FAILED) return { label: "failed", className: "bg-destructive/10 text-destructive", icon: OctagonAlert };
  if (ns === FLOW_STATUS.AWAITING_APPROVAL) return { label: "awaiting approval", className: "bg-warning/10 text-warning", icon: Clock };
  if (ns === FLOW_STATUS.RUNNING) return { label: "building", className: "bg-info/10 text-info", icon: Loader2 };
  return { label: "pending", className: "bg-zinc-500/10 text-zinc-400", icon: CircleDashed };
}

/** A code child whose step branch diverged from the integration branch (an
 *  earlier sibling already merged) — shown alongside the state chip while it
 *  diverges; the merge is the repair (never a rebase), per plan §4.6. */
function StaleBaseChip({ s }: { s: PlanStepRow }) {
  if (!s.sub_flow?.staleBase || s.status === FLOW_STATUS.DONE || s.completed_by === "skipped") return null;
  return (
    <Badge variant="outline" className="gap-1 text-[11px] shrink-0" title="This step branch was cut before an earlier sibling merged onto the integration branch — the merge will include (and resolve) that divergence; never rebased.">
      <GitMerge size={10} /> stale base
    </Badge>
  );
}

/** Per-step cost/duration (Phase 4): the child flow's own billed runs — the
 *  same units the run summaries use (dollars / ms, via lib/format helpers).
 *  Hidden entirely until the child actually ran (zeroed before the build). */
function StepCostChip({ s }: { s: PlanStepRow }) {
  const runs = s.sub_flow?.runCount ?? 0;
  if (!runs) return null;
  const cents = s.sub_flow?.costCents ?? 0;
  const dur = s.sub_flow?.durationMs ?? 0;
  const tok = s.sub_flow?.tokens ?? 0;
  return (
    <Badge variant="outline" className="gap-1 font-mono text-[11px] shrink-0"
      title={`${runs} run${runs > 1 ? "s" : ""}${tok ? ` · ${tok >= 1000 ? `${Math.round(tok / 1000)}k tok` : `${tok} tok`}` : ""}`}>
      <Coins size={10} />
      {cents > 0 ? `$${(cents / 100).toFixed(2)}` : "cost n/a"}
      {dur > 0 && <span>· {fmtDuration(dur)}</span>}
    </Badge>
  );
}

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
  if (!steps.length) return null;

  // rollup (Phase 4): resolved/failed/in-flight counts + summed child cost &
  // duration — the node-level line matching the graph subtitle's rollup
  const resolved = steps.filter((s) => s.status === FLOW_STATUS.DONE).length;
  const failed = steps.filter((s) => s.sub_flow?.nodeStatus === FLOW_STATUS.FAILED && s.status !== FLOW_STATUS.DONE).length;
  const inflight = steps.filter((s) =>
    s.status !== FLOW_STATUS.DONE &&
    (s.sub_flow?.nodeStatus === FLOW_STATUS.RUNNING || s.sub_flow?.nodeStatus === FLOW_STATUS.AWAITING_APPROVAL)).length;
  const costCents = steps.reduce((sum, s) => sum + (s.sub_flow?.costCents ?? 0), 0);
  const durationMs = steps.reduce((sum, s) => sum + (s.sub_flow?.durationMs ?? 0), 0);
  const runs = steps.reduce((sum, s) => sum + (s.sub_flow?.runCount ?? 0), 0);

  return (
    <div className="mb-4">
      <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
        <GitMerge size={14} /> Step sub-flows
      </h3>
      {runs > 0 && (
        <div className="text-[11.5px] text-muted-foreground mb-2 flex items-center gap-1.5 flex-wrap"
          title={`${runs} run${runs > 1 ? "s" : ""} across ${steps.length} step sub-flow${steps.length > 1 ? "s" : ""}`}>
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
          const st = stepState(s);
          const Icon = st.icon;
          const ms = s.sub_flow?.mergeStatus ?? null;
          const approveBlocked = ms === "conflict" || ms === "rejected" || ms === "running" || ms === "failed";
          return (
            <Card key={s.id} className="px-4 py-3 flex items-center gap-3 flex-wrap"
              title={s.sub_flow?.mergeError ?? undefined}>
              <Badge className={st.className} variant={st.label === "failed" ? "destructive" : undefined}>
                <Icon size={11} className={cn((st.label === "building" || st.label === "fixing" || st.label === "merging") && "animate-spin")} />
                {st.label}
              </Badge>
              <StaleBaseChip s={s} />
              <StepCostChip s={s} />
              <span className="min-w-0 flex-1">
                <span className="text-[13px] font-medium block truncate">{s.title}</span>
                {s.sub_flow?.branch && (
                  <span className="text-[11px] text-muted-foreground font-mono block truncate" title={s.sub_flow.mergeError ? `${s.sub_flow.branch} — ${s.sub_flow.mergeError}` : s.sub_flow.branch}>
                    {s.sub_flow.branch}
                    {s.sub_flow.mergeError && (s.sub_flow.nodeStatus !== FLOW_STATUS.RUNNING) && (
                      <span className="font-sans"> · {(s.sub_flow.mergeStatus === "failed" ? "merge failed: " : ms === "conflict" || ms === "rejected" ? "merge-fix: " : "") + s.sub_flow.mergeError.slice(0, 60)}</span>
                    )}
                  </span>
                )}
              </span>
              {s.sub_flow?.nodeStatus === FLOW_STATUS.AWAITING_APPROVAL && s.status !== FLOW_STATUS.DONE && !approveBlocked && (
                <Button size="sm" className="gap-1" disabled={actionPending}
                  onClick={() => action("approve_fanout_step", { stepId: s.id })}>
                  <Check size={12} /> Approve
                </Button>
              )}
              {s.sub_flow?.nodeStatus === FLOW_STATUS.FAILED && s.status !== FLOW_STATUS.DONE && (
                <Button size="sm" variant="outline" className="gap-1" disabled={actionPending}
                  onClick={() => action("retry_fanout_step", { stepId: s.id })}
                  title="Failed merge-backs re-run the merge (+ bounded fix agent); failed builds re-run the step build">
                  <Undo2 size={12} /> Retry
                </Button>
              )}
              {s.sub_flow && s.status !== FLOW_STATUS.DONE &&
                s.sub_flow.nodeStatus !== FLOW_STATUS.RUNNING && s.sub_flow.nodeStatus !== FLOW_STATUS.AWAITING_APPROVAL && (
                <Button size="sm" variant="outline" className="gap-1" disabled={actionPending}
                  onClick={() => action("skip_fanout_step", { stepId: s.id })}>
                  <X size={12} /> Skip
                </Button>
              )}
              {s.sub_flow && (
                <a
                  href={`/flows/${s.sub_flow.id}`}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 h-8 text-[12.5px] hover:bg-muted/40"
                  title="Open the child flow screen (graph, run activity, chat, diff, approval)"
                >
                  <ExternalLink size={12} /> Open sub-flow
                </a>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
