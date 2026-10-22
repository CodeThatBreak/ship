"use client";
import { useEffect, useState } from "react";
import { AlertTriangle, GitMerge, Pencil, RotateCcw, Settings2, Square } from "lucide-react";
import type { FlowData, Node, Artifact } from "../app/flows/[id]/page";
import PlanView from "./PlanView";
import PlanSteps from "./PlanSteps";
import DiffView from "./DiffView";
import ModelSelect from "./ModelSelect";
import ReviewView from "./ReviewView";
import PromptModal from "./PromptModal";
import { Alert } from "./ui/alert";
import { Badge, BadgeDot } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Spinner } from "./ui/spinner";
import { cn } from "../lib/utils";

function fetchArtifact(id: string) {
  return fetch(`/api/artifacts/${id}`).then((r) => r.json());
}

export default function NodePanel({
  flow, node, action, events = [],
}: { flow: FlowData; node: Node; action: (a: string, b?: any) => Promise<void> | void; events?: any[] }) {
  // The plan view owns its whole panel: sticky header, scrollable body, fixed footer.
  if (node.node_key === "plan") {
    return <PlanView flow={flow} node={node} action={action} fetchArtifact={fetchArtifact} />;
  }

  const shared = { flow, node, action, fetchArtifact, events };
  switch (node.node_key) {
    case "build":
      return <BuildView {...shared} />;
    case "pipeline":
      return <PipelineView {...shared} />;
    case "review":
      return <ReviewView {...shared} />;
    case "resolve":
      return <ResolveView {...shared} />;
    default:
      return (
        <PanelShell node={node} action={action}>
          <p className="text-muted">No panel for this node.</p>
        </PanelShell>
      );
  }
}

const PANEL_TITLES: Record<string, string> = {
  plan: "Implementation plan",
  build: "Code changes",
  pipeline: "CI pipeline",
  review: "AI review",
  resolve: "Comment resolution",
};

function statusVariant(status: string) {
  return status === "done" || status === "approved" ? "green"
    : status === "running" ? "blue"
    : status === "awaiting_approval" ? "amber"
    : status === "failed" ? "red" : "default";
}

/**
 * Shared panel layout matching the Plan panel: a sticky header (title, status,
 * cost, settings), a scrollable body, and a fixed footer for the node's
 * primary actions. Every non-plan node renders through this so the cockpit
 * feels like one consistent surface.
 */
export function PanelShell({
  node, action, headerEnd, footer, children,
}: {
  node: Node;
  action: (a: string, b?: any) => void;
  headerEnd?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  const hasOverride = Boolean((node as any).prompt_override);
  return (
    <div className="flex flex-col h-full min-h-0">
      {/* sticky header */}
      <div className="flex items-center gap-2.5 px-5 py-3 border-b border-border-soft shrink-0 flex-wrap">
        <h2 className="m-0 text-[15px]">{PANEL_TITLES[node.node_key] ?? node.node_key}</h2>
        <Badge variant={statusVariant(node.status) as any}>
          <BadgeDot />
          {node.status.replace(/_/g, " ")}
        </Badge>
        <CostChip node={node} />
        <span title={hasOverride ? "Custom prompt override" : `Template: ${node.node_key}`}>
          <Settings2
            size={14}
            className={cn("shrink-0", hasOverride ? "text-amber" : "text-muted")}
          />
        </span>
        <div className="flex-1" />
        {headerEnd}
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
        {node.status === "running" && (
          <Alert variant="default" className="mb-3.5">
            <Spinner />
            <span className="flex-1 text-muted">Working — watch the activity feed →</span>
            <Button size="sm" onClick={() => action("cancel", { nodeKey: node.node_key })}>
              <Square size={13} /> Stop
            </Button>
          </Alert>
        )}
        {children}
      </div>

      {/* fixed footer */}
      {footer && (
        <div className="flex items-center gap-3 px-5 py-3 border-t border-border-soft shrink-0 flex-wrap">
          {footer}
        </div>
      )}
    </div>
  );
}

function fmtDur(ms?: number): string {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}
function fmtTok(n?: number): string {
  if (!n) return "—";
  return n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`;
}

/** Σ of the node's runs; tooltip shows the per-run breakdown. */
export function CostChip({ node }: { node: Node }) {
  const cost = (node as any).cost as { totalCents: number; tokens: number; runs: any[] } | undefined;
  if (!cost || !cost.runs.length) return null;
  const priced = cost.runs.some((r: any) => r.cost_cents != null);
  const tooltip = cost.runs
    .map((r: any, i: number) => {
      const toks = (r.input_tokens ?? 0) + (r.output_tokens ?? 0) + (r.cache_read_tokens ?? 0) + (r.cache_write_tokens ?? 0);
      return [
        `run ${i + 1} (${r.status})`,
        r.model ?? "unknown model",
        fmtDur(r.duration_ms),
        toks ? `${fmtTok(toks)} tok` : "tokens n/a",
        r.cost_cents != null ? `$${(r.cost_cents / 100).toFixed(2)}` : "cost n/a",
      ].join(" · ");
    })
    .join("\n");
  const label = priced
    ? `$${(cost.totalCents / 100).toFixed(2)}`
    : cost.tokens > 0
      ? `${fmtTok(cost.tokens)} tok`
      : `${cost.runs.length} run${cost.runs.length > 1 ? "s" : ""}`;
  return (
    <Badge title={tooltip} className="whitespace-pre-line text-left cursor-help">
      {label}
    </Badge>
  );
}

function BuildView({ flow, node, action, fetchArtifact, events = [] }: any) {
  const diffs = node.artifacts.filter((a: Artifact) => a.kind === "diff");
  const latest = diffs[diffs.length - 1];
  const canApprove = node.status === "awaiting_approval";
  const branches = flow.branches ?? [];
  const hasBranches = branches.length > 1;
  const planSteps = flow.planSteps ?? [];

  // "approved" means the user clicked and the background task is running:
  // MR creation first, then the pipeline gate — the build stage stays in this
  // busy state until the MR exists (the engine reverts to awaiting_approval
  // with an mr_failed event if MR creation fails).
  const creatingMr = node.status === "approved" && !hasBranches && !flow.mr_url;
  const creatingMrBranches = new Set(
    hasBranches
      ? branches.filter((b: any) => (b.status === "approved" || b.status === "done") && !b.mr_url).map((b: any) => b.name)
      : []
  );
  // latest MR-creation failure per branch — cleared as soon as a newer
  // lifecycle/error event arrives (the engine only emits mr_failed for MR
  // creation failures, so anything newer means a retry is in flight)
  const mrErrorFor = (branch?: string) => {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.type === "mr_failed") {
        let b: string | undefined;
        try { b = e.data ? JSON.parse(e.data).branchName ?? undefined : undefined; } catch { /* ignore */ }
        if (b === branch) return e.message as string;
        continue;
      }
      if (e.type === "lifecycle" || e.type === "error") return null;
    }
    return null;
  };

  const approveAll = () => action("approve_build");
  const approveBranch = (name: string) => action("approve_build", { branch: name });

  const singleErr = canApprove && !hasBranches ? mrErrorFor(undefined) : null;
  const allAwaiting = canApprove && hasBranches && branches.every((b: any) => b.status === "awaiting_approval");

  const footer = (
    <>
      <span className="text-xs text-muted">
        {canApprove
          ? singleErr ?? (hasBranches ? "Review each diff, then create the merge requests." : "Review the diff, then create the merge request.")
          : creatingMr || creatingMrBranches.size > 0
            ? "Creating the merge request — the pipeline stage starts once the MR exists."
            : flow.mr_url || hasBranches
              ? "Merge request created."
              : "The diff appears here once the build finishes."}
      </span>
      <div className="flex-1" />
      {canApprove && !hasBranches && (
        <Button variant="success" onClick={approveAll}>
          <GitMerge size={14} /> {singleErr ? "Retry: accept & create MR" : "Accept & create MR"}
        </Button>
      )}
      {allAwaiting && (
        <Button variant="success" onClick={approveAll}>
          <GitMerge size={14} /> Accept all & create MRs
        </Button>
      )}
    </>
  );

  return (
    <PanelShell node={node} action={action} footer={footer}>
      {/* structured plan progress — the build agent checks steps off as it reports them */}
      {planSteps.length > 0 && (
        <PlanSteps flowId={flow.id} steps={planSteps} editable={false} highlight action={action} />
      )}
      {creatingMr && (
        <Alert variant="default" className="mb-3.5">
          <Spinner />
          <span className="flex-1 text-muted">Creating the merge request — the pipeline stage starts once the MR exists.</span>
        </Alert>
      )}
      {canApprove && !hasBranches && singleErr && (
        <Alert variant="red" className="mb-3.5">
          <AlertTriangle size={16} className="shrink-0" />
          <span className="flex-1">{singleErr}</span>
          <Button variant="success" size="sm" onClick={approveAll}>
            <GitMerge size={13} /> Retry: accept & create MR
          </Button>
        </Alert>
      )}
      {/* Phase 3C: per-branch build status + approval */}
      {hasBranches && (
        <div className="mb-4 grid gap-2">
          {branches.map((b: any) => {
            const err = b.status === "awaiting_approval" ? mrErrorFor(b.name) : null;
            return (
              <Card key={b.id} className="px-4 py-3 flex items-center gap-3 flex-wrap">
                <Badge variant={b.status === "done" ? "green" : b.status === "failed" ? "red" : b.status === "building" ? "blue" : b.status === "awaiting_approval" ? "amber" : "default"}>
                  {b.status.replace(/_/g, " ")}
                </Badge>
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-sm">{b.title ?? b.name}</span>
                  <code className="text-xs text-muted ml-2">{b.name}</code>
                  {err && <div className="text-red text-xs mt-1">{err}</div>}
                </div>
                {b.mr_url && (
                  <a href={b.mr_url} target="_blank" className="text-accent hover:underline text-xs">MR !{b.mr_iid} ↗</a>
                )}
                {creatingMrBranches.has(b.name) && (
                  <span className="inline-flex items-center gap-1.5 text-muted text-xs">
                    <Spinner /> Creating MR…
                  </span>
                )}
                {b.status === "awaiting_approval" && (
                  <Button variant="success" size="sm" onClick={() => approveBranch(b.name)}>
                    <GitMerge size={13} /> {err ? "Retry: accept & create MR" : "Accept & create MR"}
                  </Button>
                )}
              </Card>
            );
          })}
        </div>
      )}
      {!hasBranches && flow.mr_url && (
        <p className="text-[13px]">
          <a href={flow.mr_url} target="_blank" className="text-accent hover:underline">Open MR !{flow.mr_iid} ↗</a> on branch <code className="font-mono">{flow.mr_branch}</code>
        </p>
      )}
      {latest ? <ArtifactLoader id={latest.id} fetchArtifact={fetchArtifact} render={(a: any) => <DiffView raw={a.content} />} /> : !canApprove && node.status !== "running" && <p className="text-muted">No changes yet.</p>}
    </PanelShell>
  );
}

function PipelineView({ flow, node, action, fetchArtifact }: any) {
  const [showPrompt, setShowPrompt] = useState(false);
  const [model, setModel] = useState("");
  const output = node.output as { pipelineId?: number; status?: string; fixes?: number } | undefined;
  const hasMr = Boolean(flow.mr_url) || (flow.branches ?? []).some((b: any) => b.mr_url);
  const running = node.status === "running";

  const headerEnd = (
    <>
      <ModelSelect value={model} onChange={setModel} />
      <Button size="sm" variant="ghost" onClick={() => setShowPrompt(true)}>
        <Pencil size={12} /> Edit prompt
      </Button>
    </>
  );

  const footer = !running && hasMr ? (
    <>
      <span className="text-xs text-muted">
        {node.status === "done"
          ? `Pipeline #${output?.pipelineId ?? "—"} is green${output?.fixes ? ` after ${output.fixes} fix run${output.fixes > 1 ? "s" : ""}` : ""}.`
          : "Run the pipeline gate to check CI and auto-fix failures."}
      </span>
      <div className="flex-1" />
      <Button variant="primary" onClick={() => action("pipeline", { model: model || undefined })}>
        {node.status === "done" ? "Re-check pipeline" : "Check pipeline"}
      </Button>
    </>
  ) : !running && !hasMr ? (
    <span className="text-xs text-muted">Approve the build to create the merge request — the pipeline gate runs automatically once the MR exists.</span>
  ) : null;

  return (
    <>
      <PanelShell node={node} action={action} headerEnd={headerEnd} footer={footer}>
        {running && (
          <Alert variant="default" className="mb-3.5">
            <Spinner />
            <span className="flex-1 text-muted">
              Waiting for a green pipeline — one is triggered via the API when none starts, and failures are fixed automatically (see the activity feed →)
            </span>
          </Alert>
        )}
        {node.status === "done" && output?.pipelineId && (
          <Alert variant="green" className="mb-3.5">
            <span className="flex-1">
              Pipeline #{output.pipelineId} is green{output.fixes ? ` after ${output.fixes} fix run${output.fixes > 1 ? "s" : ""}` : ""}.
            </span>
          </Alert>
        )}
        <GenericArtifact node={node} kind="fix" fetchArtifact={fetchArtifact} empty="No pipeline fix runs yet." />
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

function ResolveView({ flow, node, action, fetchArtifact }: any) {
  const [showPrompt, setShowPrompt] = useState(false);
  const [model, setModel] = useState("");
  const running = node.status === "running";

  const headerEnd = (
    <>
      <ModelSelect value={model} onChange={setModel} />
      <Button size="sm" variant="ghost" onClick={() => setShowPrompt(true)}>
        <Pencil size={12} /> Edit prompt
      </Button>
    </>
  );

  const footer = !running ? (
    <>
      <span className="text-xs text-muted">Fix every open MR comment with an agent, then close the discussions.</span>
      <div className="flex-1" />
      <Button variant="primary" onClick={() => action("resolve", { model: model || undefined })}>
        Resolve comments
      </Button>
    </>
  ) : null;

  return (
    <>
      <PanelShell node={node} action={action} headerEnd={headerEnd} footer={footer}>
        <GenericArtifact node={node} kind="resolve" fetchArtifact={fetchArtifact} empty="Nothing resolved yet." />
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

function GenericArtifact({ node, kind, fetchArtifact, empty }: any) {
  const arts = node.artifacts.filter((a: Artifact) => a.kind === kind);
  const [sel, setSel] = useState<string | null>(null);
  const current = arts.find((a: Artifact) => a.id === sel) ?? arts[arts.length - 1];
  return (
    <div>
      {arts.length > 1 && <VersionTabs arts={arts} sel={current?.id} onSel={setSel} />}
      {current ? (
        <ArtifactLoader id={current.id} fetchArtifact={fetchArtifact}
          render={(a: any) => <pre className="scroll whitespace-pre-wrap bg-bg-soft border border-border-soft rounded-[10px] p-3.5 text-[12.5px] font-mono">{a.content}</pre>} />
      ) : <p className="text-muted">{empty}</p>}
    </div>
  );
}

export function VersionTabs({ arts, sel, onSel }: { arts: Artifact[]; sel?: string; onSel: (id: string) => void }) {
  return (
    <div className="flex gap-1.5 mb-3.5 flex-wrap">
      {arts.map((a) => (
        <Button key={a.id} size="sm" onClick={() => onSel(a.id)}
          className={cn(sel === a.id && "border-accent text-accent")}>
          v{a.version}{a.status === "approved" ? " ✓" : ""}
        </Button>
      ))}
    </div>
  );
}

export function ArtifactLoader({ id, fetchArtifact, render }: { id: string; fetchArtifact: (id: string) => Promise<any>; render: (a: any) => React.ReactNode }) {
  const [art, setArt] = useState<any>(null);
  useEffect(() => { let live = true; fetchArtifact(id).then((a) => live && setArt(a)); return () => { live = false; }; }, [id, fetchArtifact]);
  if (!art) return <p className="text-muted"><Spinner /> Loading…</p>;
  return <>{render(art)}</>;
}
