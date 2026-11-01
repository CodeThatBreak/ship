"use client";
import { useEffect, useState } from "react";
import { resolveClockLabel } from '../utils/resolveClockLabel';
import { CheckCheck, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PanelShell, GenericArtifact } from '../shared';
import { useNodePanel } from '../context';
import { FLOW_ACTION, FLOW_STATUS } from "@/constants/flow";

/**
 * The comment-resolution panel: the queued auto-resolve clock (the debounced
 * comment wait), the resolve runs, and the manual resolve action.
 */
export default function ResolveView() {
  const { flow, node, action, model } = useNodePanel();
  const running = node.status === FLOW_STATUS.RUNNING;

  // the queue's actual start time — "resolve queued for 14:32"; while the
  // quiet period has already elapsed it flips to a "waiting on the gate" line
  const scheduledAt: number | null = flow.resolveScheduleAt ?? null;
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    setNowMs(Date.now());
  }, [scheduledAt]);
  const clock =
    running || nowMs === null ? null : resolveClockLabel(scheduledAt, nowMs);

  const footer = !running ? (
    <>
      <span className="text-xs text-muted-foreground">Fix every open MR comment with an agent, then close the discussions.</span>
      <div className="flex-1" />
      <Button onClick={() => action(FLOW_ACTION.RESOLVE, { model: model || undefined })}>
        <CheckCheck size={14} /> Resolve comments
      </Button>
    </>
  ) : null;

  return (
    <>
      <PanelShell node={node} flow={flow} runningLabel="Agent is fixing open comments…" footer={footer}>
        {clock && (
          <div className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock size={12} />
            {clock === "pipeline-gated"
              ? "Auto-resolve is queued — it starts once the pipeline passes."
              : <>Auto-resolve of open comments starts at <span className="font-medium text-foreground">{clock}</span> (after the waiting period, once the pipeline passes).</>}
          </div>
        )}
        <GenericArtifact node={node} kind="resolve" icon={CheckCheck} empty="Nothing resolved yet." />
      </PanelShell>
    </>
  );
}
