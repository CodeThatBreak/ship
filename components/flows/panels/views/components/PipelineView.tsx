"use client";

import { useState } from "react";
import { Gauge, ListChecks, Wrench } from "lucide-react";
import type { BranchRow } from "@/types/flow";
import { FLOW_ACTION, FLOW_STATUS } from "@/constants/flow";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import { PanelShell } from "../../components/shell/PanelShell";
import { useNodePanel } from "../../context";
import { GenericArtifact } from "../../artifacts/components/GenericArtifact";
import { PipelineStatusBody } from "../../artifacts/components/PipelineStatusBody";
import { PIPELINE_TAB, type PipelineTab } from "../constants/tabs";
import { PanelTabs } from "./tabs/PanelTabs";
import { UsageArtifact } from "./tabs/UsageArtifact";

const PIPELINE_TABS = [
  { value: PIPELINE_TAB.RUNS, label: "Runs", icon: ListChecks },
  { value: PIPELINE_TAB.USAGE, label: "Usage", icon: Gauge },
] as const;

/**
 * The CI-gate panel: the pipeline status, the fix runs the gate performed, and
 * the manual re-check / retrigger actions (task 17 — retrigger presses retry
 * on the failed pipeline the gate recorded, through the panel-verb door).
 * Task 18: the status/progress body is the shared `PipelineStatusBody` (the
 * same view the `pipeline` artifact renderer shows) — this panel keeps its
 * shell, footer and actions, and its `fix` artifacts as the history slot.
 */
export default function PipelineView() {
  const { flow, node, action, model } = useNodePanel();
  const [activeTab, setActiveTab] = useState<PipelineTab>(PIPELINE_TAB.RUNS);
  const output = node.output as { pipelineId?: number; status?: string; fixes?: number } | undefined;
  const hasMr = Boolean(flow.mrUrl) || (flow.branches ?? []).some((b: BranchRow) => b.mrUrl);
  const running = node.status === FLOW_STATUS.RUNNING;

  const footer = !running && hasMr ? (
    <>
      <span className="text-xs text-muted-foreground">
        {node.status === FLOW_STATUS.DONE
          ? `Pipeline #${output?.pipelineId ?? "—"} is green${output?.fixes ? ` after ${output.fixes} fix run${output.fixes > 1 ? "s" : ""}` : ""}.`
          : "Run the pipeline gate to check CI and auto-fix failures."}
      </span>
      <div className="flex-1" />
      {node.status === FLOW_STATUS.FAILED && output?.pipelineId != null && (
        <Button variant="outline" onClick={() => action(FLOW_ACTION.RETRIGGER_PIPELINE, { nodeKey: node.nodeKey })}>
          Retrigger pipeline
        </Button>
      )}
      <Button variant="default" onClick={() => action(FLOW_ACTION.PIPELINE, { model: model || undefined })}>
        {node.status === FLOW_STATUS.DONE ? "Re-check pipeline" : "Check pipeline"}
      </Button>
    </>
  ) : !running && !hasMr ? (
    <span className="text-xs text-muted-foreground">Approve the build to create the merge request — the pipeline gate runs automatically once the MR exists.</span>
  ) : null;

  return (
    <PanelShell
      node={node}
      flow={flow}
      hideCost
      fullBleedContent
      runningLabel="Waiting for a green pipeline — failures are fixed automatically…"
      footer={footer}
    >
      <PanelTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        ariaLabel="Pipeline views"
        tabs={PIPELINE_TABS}
      >
        <TabsContent value={PIPELINE_TAB.RUNS} className="px-5 pt-4 pb-4">
          <PipelineStatusBody
            green={node.status === FLOW_STATUS.DONE}
            pipelineId={output?.pipelineId ?? null}
            fixes={output?.fixes ?? 0}
            history={<GenericArtifact node={node} kind="fix" icon={Wrench} empty="No pipeline fix runs yet." />}
          />
        </TabsContent>
        <TabsContent value={PIPELINE_TAB.USAGE} className="px-5 pt-4 pb-4">
          <UsageArtifact node={node} />
        </TabsContent>
      </PanelTabs>
    </PanelShell>
  );
}
