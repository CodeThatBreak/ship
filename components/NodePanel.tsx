"use client";
import { useEffect, useState } from "react";
import { AlertTriangle, GitMerge, Pencil, RotateCcw, Settings2, Square } from "lucide-react";
import type { FlowData, Node, Artifact } from "../app/flows/[id]/page";
import PlanView from "./PlanView";
import PlanSteps from "./PlanSteps";
import DiffView from "./DiffView";
import ReviewView from "./ReviewView";
import PromptModal from "./PromptModal";
import { Alert } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Spinner } from "./ui/spinner";
import { cn } from "../lib/utils";

function fetchArtifact(id: string) {
  return fetch(`/api/artifacts/${id}`).then((r) => r.json());
}

export default function NodePanel({
  flow, node, action, events = [], model, planOptions = { decompose: false, complex: false },
}: { flow: FlowData; node: Node; action: (a: string, b?: any) => Promise<void> | void; events?: any[]; model: string; planOptions?: { decompose: boolean; complex: boolean } }) {
  // The plan view owns its whole panel: sticky header, scrollable body, fixed footer.
  if (node.node_key === "plan") {
    return <PlanView flow={flow} node={node} action={action} fetchArtifact={fetchArtifact} model={model} planOptions={planOptions} />;
  }

  const shared = { flow, node, action, fetchArtifact, events, model };
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
          <p className="text-muted-foreground">No panel for this node.</p>
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
  return status === "done" || status === "approved" ? "bg-emerald-500/10 text-emerald-400"
    : status === "running" ? "bg-blue-500/10 text-blue-400"
      : status === "awaiting_approval" ? "bg-amber-500/10 text-amber-400"
        : status === "failed" ? undefined : undefined;
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
      <div className="flex items-center gap-2.5 px-5 py-3 border-b border-border shrink-0 flex-wrap">
        <h2 className="m-0 text-[15px]">{PANEL_TITLES[node.node_key] ?? node.node_key}</h2>
        <Badge className={statusVariant(node.status)} variant={node.status === "failed" ? "destructive" : undefined}>
          <span className="size-1.5 rounded-full bg-current" />
          {node.status.replace(/_/g, " ")}
        </Badge>
        <CostChip node={node} />
        <span title={hasOverride ? "Custom prompt override" : `Template: ${node.node_key}`}>
          <Settings2
            size={14}
            className={cn("shrink-0", hasOverride ? "text-amber-400" : "text-muted-foreground")}
          />
        </span>
        <div className="flex-1" />
        {headerEnd}
      </div>

      {/* scrollable content */}
      <div className="overflow-y-auto flex-1 min-h-0 px-5 py-4">
        {node.status === "failed" && (
          <Alert variant="destructive" className="mb-3.5">
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
            <span className="flex-1 text-muted-foreground">Working — watch the activity feed →</span>
            <Button size="sm" onClick={() => action("cancel", { nodeKey: node.node_key })}>
              <Square size={13} /> Stop
            </Button>
          </Alert>
        )}
        {children}
      </div>

      {/* fixed footer */}
      {footer && (
        <div className="flex items-center gap-3 px-5 py-3 border-t border-border shrink-0 flex-wrap">
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
      <span className="text-xs text-muted-foreground">
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
        <Button variant="default" className="bg-emerald-600 text-white hover:bg-emerald-600/90" onClick={approveAll}>
          <GitMerge size={14} /> {singleErr ? "Retry: accept & create MR" : "Accept & create MR"}
        </Button>
      )}
      {allAwaiting && (
        <Button variant="default" className="bg-emerald-600 text-white hover:bg-emerald-600/90" onClick={approveAll}>
          <GitMerge size={14} /> Accept all & create MRs
        </Button>
      )}
    </>
  );

  return (
    <PanelShell node={node} action={action} footer={footer}>
      {/* structured plan progress — the build agent checks steps off as it reports them */}
      {planSteps.length > 0 && (
        <PlanSteps flowId={flow.id} steps={planSteps} editable={false} highlight action={action} className="mb-4" />
      )}
      {creatingMr && (
        <Alert variant="default" className="mb-3.5">
          <Spinner />
          <span className="flex-1 text-muted-foreground">Creating the merge request — the pipeline stage starts once the MR exists.</span>
        </Alert>
      )}
      {canApprove && !hasBranches && singleErr && (
        <Alert variant="destructive" className="mb-3.5">
          <AlertTriangle size={16} className="shrink-0" />
          <span className="flex-1">{singleErr}</span>
          <Button variant="default" className="bg-emerald-600 text-white hover:bg-emerald-600/90" size="sm" onClick={approveAll}>
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
                <Badge className={b.status === "done" ? "bg-emerald-500/10 text-emerald-400" : b.status === "failed" ? undefined : b.status === "building" ? "bg-blue-500/10 text-blue-400" : b.status === "awaiting_approval" ? "bg-amber-500/10 text-amber-400" : undefined} variant={b.status === "failed" ? "destructive" : undefined}>
                  {b.status.replace(/_/g, " ")}
                </Badge>
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-sm">{b.title ?? b.name}</span>
                  <code className="text-xs text-muted-foreground ml-2">{b.name}</code>
                  {err && <div className="text-rose-400 text-xs mt-1">{err}</div>}
                </div>
                {b.mr_url && (
                  <a href={b.mr_url} target="_blank" className="text-blue-400 hover:underline text-xs">MR !{b.mr_iid} ↗</a>
                )}
                {creatingMrBranches.has(b.name) && (
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground text-xs">
                    <Spinner /> Creating MR…
                  </span>
                )}
                {b.status === "awaiting_approval" && (
                  <Button variant="default" className="bg-emerald-600 text-white hover:bg-emerald-600/90" size="sm" onClick={() => approveBranch(b.name)}>
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
          <a href={flow.mr_url} target="_blank" className="text-blue-400 hover:underline">Open MR !{flow.mr_iid} ↗</a> on branch <code className="font-mono">{flow.mr_branch}</code>
        </p>
      )}
      {latest ? <ArtifactLoader id={latest.id} fetchArtifact={fetchArtifact} render={(a: any) => <DiffView raw={a.content} />} /> : !canApprove && node.status !== "running" && <p className="text-muted-foreground">No changes yet.</p>}
    </PanelShell>
  );
}

function PipelineView({ flow, node, action, fetchArtifact, model }: any) {
  const [showPrompt, setShowPrompt] = useState(false);
  const output = node.output as { pipelineId?: number; status?: string; fixes?: number } | undefined;
  const hasMr = Boolean(flow.mr_url) || (flow.branches ?? []).some((b: any) => b.mr_url);
  const running = node.status === "running";

  const headerEnd = (
    <>
      <Button size="sm" variant="ghost" onClick={() => setShowPrompt(true)}>
        <Pencil size={12} /> Edit prompt
      </Button>
    </>
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
      <PanelShell node={node} action={action} headerEnd={headerEnd} footer={footer}>
        {running && (
          <Alert variant="default" className="mb-3.5">
            <Spinner />
            <span className="flex-1 text-muted-foreground">
              Waiting for a green pipeline — one is triggered via the API when none starts, and failures are fixed automatically (see the activity feed →)
            </span>
          </Alert>
        )}
        {node.status === "done" && output?.pipelineId && (
          <Alert className="bg-emerald-500/10 text-emerald-400 mb-3.5">
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

function ResolveView({ flow, node, action, fetchArtifact, model }: any) {
  const [showPrompt, setShowPrompt] = useState(false);
  const running = node.status === "running";

  const headerEnd = (
    <>
      <Button size="sm" variant="ghost" onClick={() => setShowPrompt(true)}>
        <Pencil size={12} /> Edit prompt
      </Button>
    </>
  );

  const footer = !running ? (
    <>
      <span className="text-xs text-muted-foreground">Fix every open MR comment with an agent, then close the discussions.</span>
      <div className="flex-1" />
      <Button variant="default" onClick={() => action("resolve", { model: model || undefined })}>
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
      {arts.length > 1 && <VersionTabs arts={arts} sel={current?.id} onSel={setSel} className="mb-3.5" />}
      {current ? (
        <ArtifactLoader id={current.id} fetchArtifact={fetchArtifact}
          render={(a: any) => <pre className="overflow-y-auto whitespace-pre-wrap bg-background border border-border rounded-[10px] p-3.5 text-[12.5px] font-mono">{a.content}</pre>} />
      ) : <p className="text-muted-foreground">{empty}</p>}
    </div>
  );
}

export function VersionTabs({ arts, sel, onSel, className }: { arts: Artifact[]; sel?: string; onSel: (id: string) => void; className?: string }) {
  return (
    <div className={cn("flex gap-1.5 flex-wrap", className)}>
      {arts.map((a) => (
        <Button key={a.id} size="sm" variant={sel === a.id ? "default" : "outline"} onClick={() => onSel(a.id)}>
          v{a.version}{a.status === "approved" ? " ✓" : ""}
        </Button>
      ))}
    </div>
  );
}

export function ArtifactLoader({ id, fetchArtifact, render }: { id: string; fetchArtifact: (id: string) => Promise<any>; render: (a: any) => React.ReactNode }) {
  const [art, setArt] = useState<any>(null);
  useEffect(() => { let live = true; fetchArtifact(id).then((a) => live && setArt(a)); return () => { live = false; }; }, [id, fetchArtifact]);
  if (!art) return <p className="text-muted-foreground"><Spinner /> Loading…</p>;
  return <>{render(art)}</>;
}
