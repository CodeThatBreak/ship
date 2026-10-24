"use client";
import { useState } from "react";
import { Pencil, Wrench } from "lucide-react";
import type { FlowData, Node } from "../../app/flows/[id]/page";
import PromptModal from "../PromptModal";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { PanelShell, GenericArtifact } from "./shared";
import { registerPanel } from "./registry";

/**
 * The CI-gate panel: the pipeline status, the fix runs the gate performed, and
 * the manual re-check action.
 */
function PipelineView({ flow, node, action, fetchArtifact, model }: {
  flow: FlowData; node: Node; action: (a: string, b?: any) => Promise<void> | void; fetchArtifact: (id: string) => Promise<any>; model: string;
}) {
  const [showPrompt, setShowPrompt] = useState(false);
  const output = node.output as { pipelineId?: number; status?: string; fixes?: number } | undefined;
  const hasMr = Boolean(flow.mr_url) || (flow.branches ?? []).some((b: any) => b.mr_url);
  const running = node.status === "running";

  const headerEnd = (
    <Button size="xs" variant="secondary" onClick={() => setShowPrompt(true)}>
      <Pencil size={12} /> Edit prompt
    </Button>
  );

  const footer = !running && hasMr ? (
    <>
      <span className="text-xs text-muted-foreground">
        {node.status === "done"
          ? `Pipeline #${output?.pipelineId ?? "—"} is green${output?.fixes ? ` after ${output.fixes} fix run${output.fixes > 1 ? "s" : ""}` : ""}.`
          : "Run the pipeline gate to check CI and auto-fix failures."}
      </span>
      <div className="flex-1" />
      <Button variant="default" onClick={() => action("pipeline", { model: model || undefined })}>
        {node.status === "done" ? "Re-check pipeline" : "Check pipeline"}
      </Button>
    </>
  ) : !running && !hasMr ? (
    <span className="text-xs text-muted-foreground">Approve the build to create the merge request — the pipeline gate runs automatically once the MR exists.</span>
  ) : null;

  return (
    <>
      <PanelShell node={node} action={action} flow={flow} headerEnd={headerEnd} runningLabel="Waiting for a green pipeline — failures are fixed automatically…" footer={footer}>
        {node.status === "done" && output?.pipelineId && (
          <Alert className="bg-emerald-500/10 text-emerald-400 mb-3.5">
            <span className="flex-1">
              Pipeline #{output.pipelineId} is green{output.fixes ? ` after ${output.fixes} fix run${output.fixes > 1 ? "s" : ""}` : ""}.
            </span>
          </Alert>
        )}
        <GenericArtifact node={node} kind="fix" fetchArtifact={fetchArtifact} icon={Wrench} empty="No pipeline fix runs yet." />
      </PanelShell>
      {showPrompt && (
        <PromptModal
          flowId={flow.id}
          nodeKey="pipeline"
          open={showPrompt}
          onClose={() => setShowPrompt(false)}
          onRun={(prompt, promptIsBody) => {
            action("pipeline", { prompt, promptIsBody: promptIsBody || undefined, model: model || undefined });
            setShowPrompt(false);
          }}
        />
      )}
    </>
  );
}

registerPanel({ type: "pipeline" }, PipelineView);
