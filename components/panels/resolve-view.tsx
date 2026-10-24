"use client";
import { useState } from "react";
import { CheckCheck, Clock, Pencil } from "lucide-react";
import type { FlowData, Node } from "../../app/flows/[id]/page";
import PromptModal from "../PromptModal";
import { Button } from "../ui/button";
import { PanelShell, GenericArtifact } from "./shared";
import { registerPanel } from "./registry";

/**
 * The comment-resolution panel: the queued auto-resolve clock (the debounced
 * comment wait), the resolve runs, and the manual resolve action.
 */
function ResolveView({ flow, node, action, fetchArtifact, model }: {
  flow: FlowData; node: Node; action: (a: string, b?: any) => Promise<void> | void; fetchArtifact: (id: string) => Promise<any>; model: string;
}) {
  const [showPrompt, setShowPrompt] = useState(false);
  const running = node.status === "running";

  // the queue's actual start time — "resolve queued for 14:32"; while the
  // quiet period has already elapsed it flips to a "waiting on the gate" line
  const scheduledAt: number | null = flow?.resolveScheduleAt ?? null;
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
              ? "Auto-resolve is queued — it starts once the quiet period has elapsed and the pipeline gate is clear."
              : <>Auto-resolve of open comments starts at <span className="font-medium text-foreground">{clock}</span> (after the quiet period, once the pipeline gate is clear).</>}
          </div>
        )}
        <GenericArtifact node={node} kind="resolve" fetchArtifact={fetchArtifact} icon={CheckCheck} empty="Nothing resolved yet." />
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

registerPanel({ type: "resolve" }, ResolveView);
