"use client";
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCheck, FileDiff, GitMerge, Pencil, RotateCcw, Square, Wrench } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
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
import { uncachedInputTokens } from "../lib/usage";

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
 * cost, actions), a scrollable body, and a fixed footer for the node's
 * primary actions. Every non-plan node renders through this so the cockpit
 * feels like one consistent surface.
 */
export function PanelShell({
  node, action, headerEnd, runningLabel = "Agent is working…", footer, children,
}: {
  node: Node;
  action: (a: string, b?: any) => void;
  headerEnd?: React.ReactNode;
  /** headline shown while the node is running (PlanView-style centered state) */
  runningLabel?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col h-full min-h-0">
      {/* sticky header */}
      <div className="flex items-center gap-2.5 px-5 py-3 border-b border-border shrink-0">
        <h2 className="m-0 text-[15px]">{PANEL_TITLES[node.node_key] ?? node.node_key}</h2>
        <Badge className={statusVariant(node.status)} variant={node.status === "failed" ? "destructive" : undefined}>
          <span className="size-1.5 rounded-full bg-current" />
          {node.status.replace(/_/g, " ")}
        </Badge>
        <CostChip node={node} />
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
          <div className="flex flex-col items-center justify-center text-center px-5 py-8 gap-2">
            <Spinner className="size-[22px] border-[3px]" />
            <p className="text-muted-foreground text-sm font-medium m-0">{runningLabel}</p>
            <p className="text-muted-foreground text-xs m-0">Watch the activity feed →</p>
            <Button size="sm" variant="ghost" className="mt-1" onClick={() => action("cancel", { nodeKey: node.node_key })}>
              <Square size={12} /> Stop agent
            </Button>
          </div>
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
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return `${n}`;
}
function fmtCents(c?: number | null): string {
  if (c == null) return "—";
  return c < 1 && c > 0 ? `$${c.toFixed(3)}` : `$${(c / 100).toFixed(2)}`;
}

/**
 * Σ of the node's runs (duration · tokens · cost) with a tooltip renderer that
 * breaks the total down per run: status, model, duration, the input/output/
 * cache token split, and each run's cost — so "cost n/a" rows are visible as
 * exactly that instead of being silently averaged away. `in` shows the
 * uncached portion (`uncachedInputTokens`), matching how Cursor's usage API
 * and billing break the prompt up — exactly the figures the API reports.
 */
export function CostChip({ node }: { node: Node }) {
  const cost = (node as any).cost as { totalCents: number; tokens: number; runs: any[] } | undefined;
  if (!cost || !cost.runs.length) return null;

  const rows = cost.runs.map((r: any, i: number) => {
    const input = uncachedInputTokens({
      inputTokens: r.input_tokens,
      cacheReadTokens: r.cache_read_tokens,
      cacheWriteTokens: r.cache_write_tokens,
    });
    const output = r.output_tokens ?? 0;
    const cacheRead = r.cache_read_tokens ?? 0;
    const cacheWrite = r.cache_write_tokens ?? 0;
    return { i: i + 1, status: r.status, model: r.model, durationMs: r.duration_ms, input, output, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite, costCents: r.cost_cents };
  });
  const priced = rows.some((r) => r.costCents != null);
  const totalTok = rows.reduce((s, r) => s + r.total, 0);
  const totalMs = rows.reduce((s, r) => s + (r.durationMs ?? 0), 0);

  const meta = [
    `${cost.runs.length} run${cost.runs.length > 1 ? "s" : ""}`,
    fmtTok(totalTok) !== "—" ? `${fmtTok(totalTok)} tok` : null,
    fmtDur(totalMs) !== "—" ? fmtDur(totalMs) : null,
    priced ? fmtCents(cost.totalCents) : "cost n/a",
  ].filter(Boolean).join(" · ");

  return (
    <Tooltip>
      <TooltipTrigger>
        <Badge className="cursor-help">{meta}</Badge>
      </TooltipTrigger>
      <TooltipContent className="flex-col items-stretch gap-2 px-3.5 py-3 text-[11px] w-max max-w-none" side="bottom">
        <div className="font-medium opacity-70">Token &amp; cost breakdown</div>
        <table className="border-collapse">
          <thead>
            <tr className="text-left opacity-70">
              <th className="px-2.5 py-0.5 font-normal">#</th>
              <th className="px-2.5 py-0.5 font-normal">model</th>
              <th className="px-2.5 py-0.5 font-normal text-right">in</th>
              <th className="px-2.5 py-0.5 font-normal text-right">out</th>
              <th className="px-2.5 py-0.5 font-normal text-right">cache</th>
              <th className="px-2.5 py-0.5 font-normal text-right">total</th>
              <th className="px-2.5 py-0.5 font-normal text-right">dur</th>
              <th className="px-2.5 py-0.5 font-normal text-right">cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.i} className="border-t border-background/15">
                <td className="px-2.5 py-0.5 opacity-70">{r.i}</td>
                <td className="max-w-[180px] truncate px-2.5 py-0.5">{r.model ?? "unknown"}</td>
                <td className="px-2.5 py-0.5 text-right font-mono tabular-nums">{fmtTok(r.input)}</td>
                <td className="px-2.5 py-0.5 text-right font-mono tabular-nums">{fmtTok(r.output)}</td>
                <td className="px-2.5 py-0.5 text-right font-mono tabular-nums">{fmtTok(r.cacheRead + r.cacheWrite)}</td>
                <td className="px-2.5 py-0.5 text-right font-mono tabular-nums">{fmtTok(r.total)}</td>
                <td className="px-2.5 py-0.5 text-right opacity-70">{fmtDur(r.durationMs)}</td>
                <td className="px-2.5 py-0.5 text-right">
                  {r.costCents != null ? fmtCents(r.costCents) : <span className="opacity-50">n/a</span>}
                </td>
              </tr>
            ))}
            <tr className="border-t border-background/15 font-medium">
              <td className="px-2.5 py-0.5" />
              <td className="px-2.5 py-0.5">total</td>
              <td className="px-2.5 py-0.5 text-right font-mono tabular-nums">{fmtTok(rows.reduce((s, r) => s + r.input, 0))}</td>
              <td className="px-2.5 py-0.5 text-right font-mono tabular-nums">{fmtTok(rows.reduce((s, r) => s + r.output, 0))}</td>
              <td className="px-2.5 py-0.5 text-right font-mono tabular-nums">{fmtTok(rows.reduce((s, r) => s + r.cacheRead + r.cacheWrite, 0))}</td>
              <td className="px-2.5 py-0.5 text-right font-mono tabular-nums">{fmtTok(totalTok)}</td>
              <td className="px-2.5 py-0.5 text-right opacity-70">{fmtDur(totalMs)}</td>
              <td className="px-2.5 py-0.5 text-right">{priced ? fmtCents(cost.totalCents) : <span className="opacity-50">n/a</span>}</td>
            </tr>
          </tbody>
        </table>
        {priced && <div className="opacity-60">cost is estimated from list prices — billed value unavailable</div>}
      </TooltipContent>
    </Tooltip>
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
        <Button onClick={approveAll}>
          <GitMerge size={14} /> {singleErr ? "Retry: accept & create MR" : "Accept & create MR"}
        </Button>
      )}
      {allAwaiting && (
        <Button onClick={approveAll}>
          <GitMerge size={14} /> Accept all & create MRs
        </Button>
      )}
    </>
  );

  return (
    <PanelShell node={node} action={action} runningLabel="Agent is implementing the plan…" footer={footer}>
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
          <Button size="sm" onClick={approveAll}>
            <GitMerge size={13} /> Retry: accept & create MR
          </Button>
        </Alert>
      )}
      {/* Phase 3C: per-branch build status + approval */}
      {hasBranches && (
        <div className="mb-4">
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
            <GitMerge size={14} /> Merge requests
          </h3>
          <div className="grid gap-2">
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
                    <Button size="sm" onClick={() => approveBranch(b.name)}>
                      <GitMerge size={13} /> {err ? "Retry: accept & create MR" : "Accept & create MR"}
                    </Button>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      )}
      {!hasBranches && flow.mr_url && (
        <p className="text-[13px]">
          <a href={flow.mr_url} target="_blank" className="text-blue-400 hover:underline">Open MR !{flow.mr_iid} ↗</a> on branch <code className="font-mono">{flow.mr_branch}</code>
        </p>
      )}
      {(latest || (!canApprove && node.status !== "running")) && (
        <div>
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
            <FileDiff size={14} /> Changes
          </h3>
          {latest ? (
            <ArtifactLoader id={latest.id} fetchArtifact={fetchArtifact} render={(a: any) => <DiffView raw={a.content} />} />
          ) : (
            <div className="text-center px-5 py-10">
              <GitMerge size={32} className="text-muted-foreground mb-3 mx-auto" />
              <p className="text-muted-foreground max-w-[380px] mx-auto">No changes yet.</p>
            </div>
          )}
        </div>
      )}
    </PanelShell>
  );
}

function PipelineView({ flow, node, action, fetchArtifact, model }: any) {
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
      <PanelShell node={node} action={action} headerEnd={headerEnd} runningLabel="Waiting for a green pipeline — failures are fixed automatically…" footer={footer}>
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

function ResolveView({ flow, node, action, fetchArtifact, model }: any) {
  const [showPrompt, setShowPrompt] = useState(false);
  const running = node.status === "running";

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
      <PanelShell node={node} action={action} headerEnd={headerEnd} runningLabel="Agent is fixing open comments…" footer={footer}>
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

function GenericArtifact({ node, kind, fetchArtifact, empty, icon: Icon }: any) {
  const arts = node.artifacts.filter((a: Artifact) => a.kind === kind);
  const [sel, setSel] = useState<string | null>(null);
  const current = arts.find((a: Artifact) => a.id === sel) ?? arts[arts.length - 1];
  return (
    <div>
      {arts.length > 1 && <VersionTabs arts={arts} sel={current?.id} onSel={setSel} className="mb-3.5" />}
      {current ? (
        <ArtifactLoader id={current.id} fetchArtifact={fetchArtifact}
          render={(a: any) => <pre className="overflow-y-auto whitespace-pre-wrap bg-background border border-border rounded-[10px] p-3.5 text-[12.5px] font-mono">{a.content}</pre>} />
      ) : (
        <div className="text-center px-5 py-16">
          {Icon && <Icon size={32} className="text-muted-foreground mb-3 mx-auto" />}
          <p className="text-muted-foreground max-w-[380px] mx-auto">{empty}</p>
        </div>
      )}
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
