"use client";
import { useEffect, useState } from "react";
import { AlertTriangle, Clock, RotateCcw, Square } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import type { FlowData, Node, Artifact } from "../../app/flows/[id]/page";
import { Alert } from "../ui/alert";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Spinner } from "../ui/spinner";
import { cn } from "../../lib/utils";
import { uncachedInputTokens } from "../../lib/usage";

/** The panel header title: the node contract's panel title wins, then the
 *  template label override, the template's own display name, the instance key. */
export function panelTitle(node: Node): string {
  return node.capabilities?.panelTitle ?? node.label ?? node.template_name ?? node.node_key;
}

export function statusVariant(status: string) {
  return status === "done" || status === "approved" ? "bg-success/10 text-success"
    : status === "running" ? "bg-info/10 text-info"
      : status === "awaiting_approval" ? "bg-warning/10 text-warning"
        // waiting / skipped / pending all render muted; these statuses are
        // reserved for Phase 3 (event waits, non-taken branches)
        : status === "failed" ? undefined : undefined;
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
 * Shared panel layout matching the Plan panel: a sticky header (title, status,
 * cost, actions), a scrollable body, and a fixed footer for the node's
 * primary actions. Every non-plan node renders through this so the cockpit
 * feels like one consistent surface.
 */
export function PanelShell({
  node, action, headerEnd, runningLabel = "Agent is working…", footer, children, flow, hideFailed,
}: {
  node: Node;
  action: (a: string, b?: any) => void;
  /** when given, the waiting-state banner shows the node's hook endpoint (Phase 4B) */
  flow?: FlowData;
  headerEnd?: React.ReactNode;
  /** headline shown while the node is running (PlanView-style centered state) */
  runningLabel?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
  /** start nodes surface their own failed alert (the form doubles as the fix) */
  hideFailed?: boolean;
}) {
  return (
    <div className="flex flex-col h-full min-h-0">
      {/* sticky header */}
      <div className="flex items-center gap-2.5 px-5 py-3 border-b border-border shrink-0">
        <h2 className="m-0 text-[15px]">{panelTitle(node)}</h2>
        <Badge className={statusVariant(node.status)} variant={node.status === "failed" ? "destructive" : undefined}>
          <span className="size-1.5 rounded-full bg-current" />
          {node.status.replace(/_/g, " ")}
        </Badge>
        <CostChip node={node} />
        <div className="flex-1" />
        {headerEnd}
      </div>

      {/* scrollable content */}
      <ScrollArea className="flex-1">
        <div className="px-5 py-4">
        {!hideFailed && node.status === "failed" && (
          <Alert variant="destructive" className="mb-3.5">
            <AlertTriangle size={16} className="shrink-0" />
            <span className="flex-1">This step failed — check the activity feed for details.</span>
            <Button size="sm" onClick={() => action("retry", { nodeKey: node.node_key })}>
              <RotateCcw size={13} /> Retry
            </Button>
          </Alert>
        )}
        {node.status === "waiting" && <WaitBanner flow={flow} node={node} />}
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
      </ScrollArea>

      {/* fixed footer */}
      {footer && (
        <div className="flex items-center gap-3 px-5 py-3 border-t border-border shrink-0 flex-wrap">
          {footer}
        </div>
      )}
    </div>
  );
}

/**
 * The waiting state (§6 node wait_for): the node is eligible but its event
 * source hasn't delivered yet. When the flow carries the node's inbound hook
 * (wait_for webhook), the banner shows the endpoint + secret and a copyable
 * curl example — what was delivered and what resumes the node is never
 * buried in run logs.
 */
function WaitBanner({ flow, node }: { flow?: FlowData; node: Node }) {
  const hook = (flow?.hooks ?? []).find((h) => h.node_key === node.node_key);
  const base = typeof window !== "undefined" ? window.location.origin : "";
  return (
    <Alert className="mb-3.5">
      <Clock size={16} className="shrink-0" />
      <span className="flex-1 text-[12.5px] text-muted-foreground">
        Waiting for its event source — it resumes automatically on delivery.
        {hook && (
          <>
            <br />
            POST to <code className="font-mono text-foreground">{base}/api/hooks/{hook.id}</code>
            {" "}· secret <code className="font-mono text-foreground">{hook.secret}</code>
          </>
        )}
      </span>
      {hook && (
        <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard?.writeText(
          `curl -X POST ${base}/api/hooks/${hook.id} -H "content-type: application/json" -H "x-devflow-secret: ${hook.secret}" -d '{"ping":true}'`
        )}>
          Copy curl example
        </Button>
      )}
    </Alert>
  );
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

/** Versioned artifact tabs + a single fetched artifact rendered by the caller. */
export function GenericArtifact({ node, kind, fetchArtifact, empty, icon: Icon }: any) {
  const arts = node.artifacts.filter((a: Artifact) => a.kind === kind);
  const [sel, setSel] = useState<string | null>(null);
  const current = arts.find((a: Artifact) => a.id === sel) ?? arts[arts.length - 1];
  return (
    <div>
      {arts.length > 1 && <VersionTabs arts={arts} sel={current?.id} onSel={setSel} className="mb-3.5" />}
      {current ? (
        <ArtifactLoader id={current.id} fetchArtifact={fetchArtifact}
          render={(a: any) => <pre className="overflow-y-auto whitespace-pre-wrap bg-background border border-border rounded-lg p-3.5 text-[12.5px] font-mono">{a.content}</pre>} />
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
