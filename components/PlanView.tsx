"use client";
import { useState } from "react";
import { Compass, Check, GitBranch, FileCode, ListChecks, Layers, AlertTriangle, RotateCcw, Pencil, Info, Square } from "lucide-react";
import type { FlowData, Node, Artifact } from "../app/flows/[id]/page";
import Markdown from "./Markdown";
import ModelSelect from "./ModelSelect";
import PlanSteps from "./PlanSteps";
import PromptModal from "./PromptModal";
import { VersionTabs, ArtifactLoader, CostChip } from "./NodePanel";
import { Alert } from "./ui/alert";
import { Badge, BadgeDot } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Checkbox } from "./ui/checkbox";
import { Spinner } from "./ui/spinner";
import { Tooltip } from "./ui/tooltip";

export default function PlanView({ flow, node, action, fetchArtifact }:
  { flow: FlowData; node: Node; action: (a: string, b?: any) => void; fetchArtifact: (id: string) => Promise<any> }) {
  const plans = node.artifacts.filter((a: Artifact) => a.kind === "plan");
  const [sel, setSel] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [decompose, setDecompose] = useState(false);
  const [model, setModel] = useState("");
  const current = plans.find((a) => a.id === sel) ?? plans[plans.length - 1];
  const awaiting = node.status === "awaiting_approval";
  const running = node.status === "running";
  const isCurrent = current && current.id === plans[plans.length - 1]?.id;

  // Phase 3A: extract branches from the plan output or artifact meta
  const branches = node.output?.branches ?? null;
  // structured checklist (live rows; editable until the plan is approved)
  const planSteps = flow.planSteps ?? [];
  const showChecklist = planSteps.length > 0 || awaiting || node.status === "approved";

  const statusVariant =
    node.status === "approved" ? "green"
    : node.status === "running" ? "blue"
    : node.status === "awaiting_approval" ? "amber"
    : node.status === "failed" ? "red" : "default";

  const startPlan = (prompt?: string, promptIsBody?: boolean) =>
    action("start_plan", { prompt, promptIsBody: promptIsBody || undefined, decompose: decompose || undefined, model: model || undefined });

  // Edit prompt runs a fresh plan when none exists yet; once a plan exists it
  // reruns as a refinement of the current one.
  const runWithPrompt = (prompt: string, promptIsBody: boolean) => {
    if (plans.length > 0) {
      action("refine_plan", { feedback: "", prompt, promptIsBody: promptIsBody || undefined, model: model || undefined });
    } else {
      startPlan(prompt, promptIsBody);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* sticky header */}
      <div className="flex items-center gap-2.5 px-5 py-3 border-b border-border-soft shrink-0">
        <h2 className="m-0 text-[15px]">Implementation plan</h2>
        <Badge variant={statusVariant as any}>
          <BadgeDot />
          {node.status.replace(/_/g, " ")}
        </Badge>
        <CostChip node={node} />
        <div className="flex-1" />
        <ModelSelect value={model} onChange={setModel} />
        <Button size="sm" variant="ghost" onClick={() => setShowPrompt(true)}>
          <Pencil size={12} /> Edit prompt
        </Button>
      </div>

      {/* scrollable content */}
      <div className="scroll flex-1 min-h-0 px-5 py-4">
        {node.status === "failed" && (
          <Alert variant="red" className="mb-3.5">
            <AlertTriangle size={16} className="shrink-0" />
            <span className="flex-1">This step failed — check the activity feed for details.</span>
            <Button size="sm" onClick={() => action("retry", { nodeKey: node.node_key })}>
              <RotateCcw size={13} /> Retry
            </Button>
          </Alert>
        )}

        {plans.length === 0 && node.status === "pending" && (
          <div className="text-center px-5 py-16">
            <Compass size={32} className="text-muted mb-3 mx-auto" />
            <p className="text-muted max-w-[380px] mx-auto">
              Generate an implementation plan from the ticket PRD, Figma links, and the repository.
            </p>
          </div>
        )}

        {running && (
          <div className="flex flex-col items-center justify-center text-center px-5 py-20 gap-3">
            <Spinner className="size-[22px] border-[3px]" />
            <p className="text-text-dim text-sm font-medium m-0">
              {plans.length === 0 ? "Agent is cooking up the plan…" : "Agent is reworking the plan…"}
            </p>
            <p className="text-muted text-xs m-0">Grabbing coffee while it reads the repo — watch the activity feed →</p>
            <Button size="sm" variant="ghost" className="mt-1" onClick={() => action("cancel", { nodeKey: node.node_key })}>
              <Square size={12} /> Stop agent
            </Button>
          </div>
        )}

        {plans.length > 1 && <VersionTabs arts={plans} sel={current?.id} onSel={setSel} />}

        {/* structured editable checklist — the machine-readable plan steps */}
        {showChecklist && (
          <PlanSteps flowId={flow.id} steps={planSteps} editable={awaiting} action={action} />
        )}

        {/* Phase 3A: branch cards for multi-branch plans */}
        {branches && branches.length > 1 && (
          <div className="mb-4">
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
              <GitBranch size={14} /> {branches.length} branches planned
            </h3>
            <div className="grid gap-2">
              {branches.map((b: any, i: number) => (
                <Card key={b.name} className="px-4 py-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Badge variant="blue">{b.name}</Badge>
                    <span className="font-medium text-sm">{b.title}</span>
                    {b.dependsOn?.length > 0 && (
                      <span className="text-xs text-muted">depends on: {b.dependsOn.join(", ")}</span>
                    )}
                  </div>
                  {b.scope && <p className="text-xs text-muted mb-1.5">{b.scope}</p>}
                  <div className="flex gap-3 text-xs text-muted">
                    <span className="flex items-center gap-1"><FileCode size={11} /> {b.files?.length ?? 0} files</span>
                    <span className="flex items-center gap-1"><ListChecks size={11} /> {b.steps?.length ?? 0} steps</span>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        )}

        {current && (
          <ArtifactLoader id={current.id} fetchArtifact={fetchArtifact}
            render={(a: any) => (
              <div>
                {a.meta?.feedback && (
                  <div className="text-xs text-muted border-l-[3px] border-purple pl-2.5 mb-3">
                    Refined from feedback: "{a.meta.feedback}"
                  </div>
                )}
                <Card className="md px-[18px] py-1 pb-3.5">
                  <Markdown text={a.content} />
                </Card>
              </div>
            )} />
        )}

        {awaiting && isCurrent && (
          <p className="text-muted text-xs mt-4 mb-0">
            Want changes? Refine the plan from the chat on the right →
          </p>
        )}
      </div>

      {/* fixed footer */}
      {(plans.length === 0 && node.status === "pending") || (awaiting && isCurrent) ? (
        <div className="flex items-center gap-3 px-5 py-3 border-t border-border-soft shrink-0">
          {plans.length === 0 && node.status === "pending" ? (
            <>
              <label className="flex items-center gap-2 text-xs text-muted cursor-pointer select-none">
                <Checkbox checked={decompose} onCheckedChange={(v) => setDecompose(v === true)} />
                <Layers size={13} /> Decompose into sub-agents
              </label>
              <Tooltip
                content={
                  flow.execution_mode === "local"
                    ? "Use built-in Task subagents to explore different areas of the repo in parallel, then merge the results into a single cohesive plan."
                    : "Delegate exploration of different repo areas to sub-agents, then merge the results into a single cohesive plan."
                }
              >
                <Info size={13} className="text-muted hover:text-text-dim cursor-help" />
              </Tooltip>
              <div className="flex-1" />
              <Button variant="primary" onClick={() => startPlan()}>
                <Compass size={15} /> Generate plan
              </Button>
            </>
          ) : (
            <>
              <span className="text-xs text-muted">Ready to build?</span>
              <div className="flex-1" />
              <Button variant="success" onClick={() => action("approve_plan")}>
                <Check size={15} /> {branches?.length > 1 ? `Approve all ${branches.length} branches & start build` : "Approve plan & start build"}
              </Button>
            </>
          )}
        </div>
      ) : null}

      {showPrompt && (
        <PromptModal
          flowId={flow.id}
          nodeKey="plan"
          open={showPrompt}
          onClose={() => setShowPrompt(false)}
          onRun={(prompt, promptIsBody) => {
            runWithPrompt(prompt, promptIsBody);
            setShowPrompt(false);
          }}
        />
      )}
    </div>
  );
}
