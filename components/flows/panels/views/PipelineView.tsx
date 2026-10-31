"use client";
import { useState } from "react";
import { Pencil, Wrench } from "lucide-react";
import type { BranchRow } from "@/types/flow";
import { FLOW_ACTION, FLOW_STATUS } from "@/constants/flow";
import PromptModal from "@/components/chat/promptModal/PromptModal";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PanelShell, GenericArtifact } from '../shared';
import { useNodePanel } from '../context';

/**
 * The CI-gate panel: the pipeline status, the fix runs the gate performed, and
 * the manual re-check action.
 */
export default function PipelineView() {
  const { flow, node, action, model } = useNodePanel();
  const [showPrompt, setShowPrompt] = useState(false);
  const output = node.output as { pipelineId?: number; status?: string; fixes?: number } | undefined;
  const hasMr = Boolean(flow.mr_url) || (flow.branches ?? []).some((b: BranchRow) => b.mr_url);
  const running = node.status === FLOW_STATUS.RUNNING;

  const headerEnd = (
    <Button size="xs" variant="secondary" onClick={() => setShowPrompt(true)}>
      <Pencil size={12} /> Edit prompt
    </Button>
  );

  const footer = !running && hasMr ? (
    <>
      <span className="text-xs text-muted-foreground">
        {node.status === FLOW_STATUS.DONE
          ? `Pipeline #${output?.pipelineId ?? "—"} is green${output?.fixes ? ` after ${output.fixes} fix run${output.fixes > 1 ? "s" : ""}` : ""}.`
          : "Run the pipeline gate to check CI and auto-fix failures."}
      </span>
      <div className="flex-1" />
      <Button variant="default" onClick={() => action(FLOW_ACTION.PIPELINE, { model: model || undefined })}>
        {node.status === FLOW_STATUS.DONE ? "Re-check pipeline" : "Check pipeline"}
      </Button>
    </>
  ) : !running && !hasMr ? (
    <span className="text-xs text-muted-foreground">Approve the build to create the merge request — the pipeline gate runs automatically once the MR exists.</span>
  ) : null;

  return (
    <>
      <PanelShell node={node} flow={flow} headerEnd={headerEnd} runningLabel="Waiting for a green pipeline — failures are fixed automatically…" footer={footer}>
        {node.status === FLOW_STATUS.DONE && output?.pipelineId && (
          <Alert className="bg-success/10 text-success mb-3.5">
            <span className="flex-1">
              Pipeline #{output.pipelineId} is green{output.fixes ? ` after ${output.fixes} fix run${output.fixes > 1 ? "s" : ""}` : ""}.
            </span>
          </Alert>
        )}
        <GenericArtifact node={node} kind="fix" icon={Wrench} empty="No pipeline fix runs yet." />
      </PanelShell>
      {showPrompt && (
        <PromptModal
          flowId={flow.id}
          nodeKey="pipeline"
          open={showPrompt}
          onClose={() => setShowPrompt(false)}
          onRun={(prompt, promptIsBody) => {
            action(FLOW_ACTION.PIPELINE, { prompt, promptIsBody: promptIsBody || undefined, model: model || undefined });
            setShowPrompt(false);
          }}
        />
      )}
    </>
  );
}
