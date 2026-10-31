"use client";
import { useState } from "react";
import { CheckCheck, Pencil, Play, Sparkles } from "lucide-react";
import type { Artifact, PlanStepRow } from "@/types/flow";
import { Markdown } from "@/components/shared/Markdown";
import { EmptyHint } from "@/components/shared/EmptyHint";
import { PanelShell, ArtifactLoader, VersionTabs } from '../shared';
import type { ArtifactPayload } from '../shared';
import { useNodePanel } from '../context';
import FanoutStepList from '../FanoutStepList';
import { FLOW_ACTION, FLOW_STATUS, isFailedStatus } from "@/constants/flow";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";

/**
 * The generic runtime panel for declarative nodes (§8 2C): prompt view/edit,
 * run button + model picker, markdown/JSON output viewer, approval button and
 * a Configure dialog that writes the flow instance config (nodes.config).
 * Plan fan-out (Phase 1D): when the node fanned out, the prompt card is
 * replaced by the step cards so the per-step monitoring surface exists for
 * declarative parent nodes too.
 */
export default function AgentView() {
  const { flow, node, action, actionAsync, model } = useNodePanel();
  const cfg = (node.config ?? {}) as { prompt?: string; mode?: string; output?: string };
  const outputKind = cfg.output === "json" ? "json" : "markdown";
  const [editPrompt, setEditPrompt] = useState(false);
  const [draft, setDraft] = useState("");

  const running = node.status === FLOW_STATUS.RUNNING;
  const pending = node.status === FLOW_STATUS.PENDING;
  const awaitingApproval = node.status === FLOW_STATUS.AWAITING_APPROVAL;
  const finished = node.status === FLOW_STATUS.DONE || node.status === FLOW_STATUS.APPROVED;
  const failed = isFailedStatus(node.status);
  const mdArts = node.artifacts.filter((a: Artifact) => a.kind === (outputKind === "json" ? "json" : "markdown"));
  const latest = mdArts[mdArts.length - 1];
  const [selId, setSelId] = useState<string | null>(null);
  const current = mdArts.find((a) => a.id === selId) ?? latest;
  // plan fan-out: the node's panel swaps the prompt card for the step cards
  const fannedOut = (flow.planSteps ?? []).some((s: PlanStepRow) => s.sub_flow != null);

  const footer = (
    <>
      <span className="text-xs text-muted-foreground">
        {awaitingApproval
          ? "Output is ready — approve it to activate the next steps."
          : finished
            ? "Output ready. Configure the node and re-run in a new flow for changes."
            : pending
              ? `Run this ${cfg.mode === "agent" ? "agent-mode" : "plan-mode"} step to produce the node's output.`
              : failed
                ? "The run failed — retry it once the issue is fixed."
                : ""}
      </span>
      <div className="flex-1" />
      {awaitingApproval && (
        <Button onClick={() => action(FLOW_ACTION.APPROVE_NODE, { nodeKey: node.node_key })}>
          <CheckCheck size={14} /> Approve
        </Button>
      )}
      {pending && !running && (
        <Button onClick={() => action(FLOW_ACTION.RUN_NODE, { nodeKey: node.node_key, model: model || undefined })}>
          <Play size={13} /> Run
        </Button>
      )}
    </>
  );

  const headerEnd = (
    <Button size="xs" variant="secondary" onClick={() => { setDraft(cfg.prompt ?? ""); setEditPrompt(true); }}>
      <Pencil size={12} /> Configure
    </Button>
  );

  return (
    <>
      <PanelShell node={node} flow={flow} headerEnd={headerEnd} runningLabel={`${node.label || node.template_name || node.node_key} is running…`} footer={footer}>
        {/* fanned out: per-step monitoring surface instead of the single prompt card */}
        {fannedOut && <FanoutStepList flow={flow} node={node} />}
        {/* prompt card — what the agent will be asked, after {{var}} rendering */}
        {!fannedOut && !running && !failed && (
          <Card className="p-3.5 mb-3.5">
            <div className="flex items-center gap-1.5 mb-1.5 text-[11.5px] font-medium text-muted-foreground uppercase tracking-[0.8px]">
              <Sparkles size={12} /> Prompt
            </div>
            {cfg.prompt
              ? <p className="text-[12.5px] whitespace-pre-wrap text-foreground/85 m-0">{cfg.prompt}</p>
              : <p className="text-[12.5px] text-muted-foreground m-0">No prompt configured — click Configure.</p>}
          </Card>
        )}
        {/* output — latest artifact version (wraps the artifact loader children) */}
        {current && (
          <div>
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
              <Sparkles size={14} /> Output
            </h3>
            {mdArts.length > 1 && (
              <VersionTabs arts={mdArts} sel={current.id} onSel={setSelId} className="mb-3.5" />
            )}
            <ArtifactLoader id={current.id}
              render={(loaded: ArtifactPayload) => outputKind === "json"
                ? <pre className="overflow-y-auto whitespace-pre-wrap bg-background border border-border rounded-lg p-3.5 text-[12.5px] font-mono">{loaded.content}</pre>
                : <Markdown className="text-[13px] [&>*:first-child]:mt-0">{loaded.content}</Markdown>} />
          </div>
        )}
        {!current && !running && !failed && (
          <EmptyHint icon={Sparkles}>
            No output yet. {pending ? "Click Run to start." : ""}
          </EmptyHint>
        )}
      </PanelShell>

      {/* Configure — instance-local prompt override (nodes.config) */}
      <Dialog open={editPrompt} onOpenChange={setEditPrompt}>
        <DialogContent className="sm:max-w-[640px]">
          <DialogHeader>
            <DialogTitle>Configure {node.label || node.template_name || node.node_key}</DialogTitle>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor="agent-prompt-override">
              Prompt (saved to this flow only)
            </FieldLabel>
            <Textarea
              id="agent-prompt-override"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={10}
              className="font-mono text-[12px]"
            />
            <FieldDescription className="m-0">
              Variables: <code className="font-mono">{"{{task.*}}"}</code>,{" "}
              <code className="font-mono">{"{{flow.*}}"}</code>,{" "}
              <code className="font-mono">{"{{repo.*}}"}</code>,{" "}
              <code className="font-mono">{"{{nodes.<key>.output.*}}"}</code>
            </FieldDescription>
          </Field>
          <DialogFooter>
            <Button
              onClick={() => {
                void actionAsync("set_node_config", {
                  nodeKey: node.node_key,
                  config: { prompt: draft },
                }).then(() => setEditPrompt(false));
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
