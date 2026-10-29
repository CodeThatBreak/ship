"use client";
import { useState } from "react";
import { CheckCheck, Clock, Pencil } from "lucide-react";
import { PromptModal } from "@/components/chat";
import { Button } from "@/components/ui/button";
import { PanelShell, GenericArtifact } from "./shared";
import { useNodePanel } from "./context";
import { FLOW_STATUS } from "@/constants/flow";

/**
 * The comment-resolution panel: the queued auto-resolve clock (the debounced
 * comment wait), the resolve runs, and the manual resolve action.
 */
export default function ResolveView() {
  const { flow, node, action, model } = useNodePanel();
  const [showPrompt, setShowPrompt] = useState(false);
  const running = node.status === FLOW_STATUS.RUNNING;

  // the queue's actual start time — "resolve queued for 14:32"; while the
  // quiet period has already elapsed it flips to a "waiting on the gate" line
  const scheduledAt: number | null = flow.resolveScheduleAt ?? null;
  const clock = running ? null
    : scheduledAt == null ? null
      : scheduledAt > Date.now()
        ? new Date(scheduledAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })
        : "pipeline-gated";

  const headerEnd = (
    <Button size="xs" variant="secondary" onClick={() => setShowPrompt(true)}>
      <Pencil size={12} /> Edit prompt
    </Button>
  );

  const footer = !running ? (
    <>
      <span className="text-xs text-muted-foreground">Fix every open MR comment with an agent, then close the discussions.</span>
      <div className="flex-1" />
      <Button onClick={() => action("resolve", { model: model || undefined })}>
        <CheckCheck size={14} /> Resolve comments
      </Button>
    </>
  ) : null;

  return (
    <>
      <PanelShell node={node} action={action} flow={flow} headerEnd={headerEnd} runningLabel="Agent is fixing open comments…" footer={footer}>
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
      {showPrompt && (
        <PromptModal
          flowId={flow.id}
          nodeKey="resolve"
          open={showPrompt}
          onClose={() => setShowPrompt(false)}
          onRun={(prompt, promptIsBody) => {
            action("resolve", { prompt, promptIsBody: promptIsBody || undefined, model: model || undefined });
            setShowPrompt(false);
          }}
        />
      )}
    </>
  );
}
