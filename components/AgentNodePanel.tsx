"use client";
import { useState } from "react";
import { CheckCheck, Pencil, Play, Sparkles } from "lucide-react";
import type { FlowData, Node, Artifact } from "../app/flows/[id]/page";
import { Markdown } from "./markdown";
import { PanelShell, ArtifactLoader, VersionTabs } from "./panels/shared";
import { registerPanel } from "./panels/registry";
import FanoutStepList from "./panels/FanoutStepList";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "./ui/dialog";
import { Textarea } from "./ui/textarea";
import { Field, FieldDescription, FieldLabel } from "./ui/field";

/**
 * The generic runtime panel for declarative nodes (§8 2C): prompt view/edit,
 * run button + model picker, markdown/JSON output viewer, approval button and
 * a Configure dialog that writes the flow instance config (nodes.config).
 * Plan fan-out (Phase 1D): when the node fanned out, the prompt card is
 * replaced by the step cards so the per-step monitoring surface exists for
 * declarative parent nodes too.
 */
export default function AgentView({
  flow, node, action, model, fetchArtifact,
}: {
  flow: FlowData;
  node: Node;
  action: (a: string, b?: any) => Promise<void> | void;
  model: string;
  fetchArtifact: (id: string) => Promise<any>;
}) {
  const cfg = (node.config ?? {}) as { prompt?: string; mode?: string; output?: string };
  const outputKind = cfg.output === "json" ? "json" : "markdown";
  const [editPrompt, setEditPrompt] = useState(false);
  const [draft, setDraft] = useState("");

  const running = node.status === "running";
  const pending = node.status === "pending";
  const awaitingApproval = node.status === "awaiting_approval";
  const finished = node.status === "done" || node.status === "approved";
  const failed = node.status === "failed";
  const mdArts = node.artifacts.filter((a: Artifact) => a.kind === (outputKind === "json" ? "json" : "markdown"));
  const latest = mdArts[mdArts.length - 1];
  // plan fan-out: the node's panel swaps the prompt card for the step cards
  const fannedOut = (flow.planSteps ?? []).some((s: any) => s.sub_flow != null);

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
        <Button onClick={() => action("approve_node", { nodeKey: node.node_key })}>
          <CheckCheck size={14} /> Approve
        </Button>
      )}
      {pending && !running && (
        <Button onClick={() => action("run_node", { nodeKey: node.node_key, model: model || undefined })}>
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
      <PanelShell node={node} action={action} flow={flow} headerEnd={headerEnd} runningLabel={`${node.label || node.template_name || node.node_key} is running…`} footer={footer}>
        {/* fanned out: per-step monitoring surface instead of the single prompt card */}
        {fannedOut && <FanoutStepList flow={flow} node={node} action={action} />}
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
        {latest && (
          <div>
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
              <Sparkles size={14} /> Output
            </h3>
            {mdArts.length > 1 && <VersionTabs arts={mdArts} sel={latest.id} onSel={() => {}} className="mb-3.5" />}
            <ArtifactLoader id={latest.id} fetchArtifact={fetchArtifact}
              render={(a: any) => outputKind === "json"
                ? <pre className="overflow-y-auto whitespace-pre-wrap bg-background border border-border rounded-lg p-3.5 text-[12.5px] font-mono">{a.content}</pre>
                : <Markdown className="text-[13px] [&>*:first-child]:mt-0">{a.content}</Markdown>} />
          </div>
        )}
        {!latest && !running && !failed && (
          <div className="text-center px-5 py-10">
            <Sparkles size={32} className="text-muted-foreground mb-3 mx-auto" />
            <p className="text-muted-foreground max-w-[380px] mx-auto">No output yet. {pending ? "Click Run to start." : ""}</p>
          </div>
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
              onClick={async () => {
                await action("set_node_config", { nodeKey: node.node_key, config: { prompt: draft } });
                setEditPrompt(false);
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

// registered with the panel registry (§3.1) — served by the declarative agent kind
registerPanel({ kind: "agent" }, AgentView);
