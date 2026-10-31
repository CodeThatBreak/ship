"use client";
import { AlertTriangle, Clock, RotateCcw, Square } from "lucide-react";
import type { FlowData, Node } from "@/types/flow";
import {
  FLOW_ACTION,
  FLOW_STATUS,
  isFailedStatus,
  statusVariantOf,
} from "@/constants/flow";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import { errorMessageOf } from "@/hooks/fetch-json";
import { CostChip } from "./CostChip";
import { apiFetch } from "@/hooks/local-api-token";
import { useNodePanel } from "./context";

/** The panel header title: the node contract's panel title wins, then the
 *  template label override, the template's own display name, the instance key. */
export function panelTitle(node: Node): string {
  return node.capabilities?.panelTitle ?? node.label ?? node.template_name ?? node.node_key;
}

/** @deprecated prefer `statusVariantOf` from `@/constants/flow` — this stays
 *  only because the panels' barrel re-exports it (see ./shared). */
export const statusVariant = statusVariantOf;

/**
 * Shared panel layout matching the Plan panel: a sticky header (title, status,
 * cost, actions), a scrollable body, and a fixed footer for the node's
 * primary actions. Every non-plan node renders through this so the cockpit
 * feels like one consistent surface.
 */
export function PanelShell({
  node, headerEnd, runningLabel = "Agent is working…", footer, children, flow, hideFailed,
}: {
  node: Node;
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
  const {
    action,
    actionPending,
    actionError,
    retryAction,
    resetAction,
    flow: contextFlow,
  } = useNodePanel();
  const cockpitFlow = flow ?? contextFlow;
  const actionMessage = errorMessageOf(actionError);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* sticky header */}
      <div className="flex items-center gap-2.5 px-5 py-3 border-b border-border shrink-0">
        <h2 className="m-0 text-[15px]">{panelTitle(node)}</h2>
        <Badge className={statusVariantOf(node.status)} variant={isFailedStatus(node.status) ? "destructive" : undefined}>
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
        {actionMessage && (
          <Alert variant="destructive" className="mb-3.5">
            <AlertTriangle size={16} className="shrink-0" />
            <span className="flex-1">{actionMessage}</span>
            <Button size="sm" variant="outline" onClick={() => retryAction()}>
              <RotateCcw size={13} /> Retry
            </Button>
            <Button size="sm" variant="ghost" onClick={() => resetAction()}>
              Dismiss
            </Button>
          </Alert>
        )}
        {!hideFailed && node.status === FLOW_STATUS.FAILED && (
          <Alert variant="destructive" className="mb-3.5">
            <AlertTriangle size={16} className="shrink-0" />
            <span className="flex-1">This step failed — check the activity feed for details.</span>
            <Button
              size="sm"
              disabled={actionPending}
              onClick={() => action(FLOW_ACTION.RETRY, { nodeKey: node.node_key })}
            >
              <RotateCcw size={13} /> Retry
            </Button>
          </Alert>
        )}
        {node.status === FLOW_STATUS.WAITING && <WaitBanner flow={cockpitFlow} node={node} />}
        {node.status === FLOW_STATUS.RUNNING && (
          <div className="flex flex-col items-center justify-center text-center px-5 py-8 gap-2">
            <Spinner className="size-[22px] border-[3px]" />
            <p className="text-muted-foreground text-sm font-medium m-0">{runningLabel}</p>
            <p className="text-muted-foreground text-xs m-0">Watch the activity feed →</p>
            <Button
              size="sm"
              variant="ghost"
              className="mt-1"
              disabled={actionPending}
              onClick={() => action(FLOW_ACTION.CANCEL, { nodeKey: node.node_key })}
            >
              <Square size={12} /> Stop agent
            </Button>
          </div>
        )}
        {children}
        </div>
      </ScrollArea>

      {/* fixed footer */}
      {footer && (
        <div
          className={`flex items-center gap-3 px-5 py-3 border-t border-border shrink-0 flex-wrap${actionPending ? " opacity-60 pointer-events-none" : ""}`}
          aria-busy={actionPending}
        >
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
  const hookPath = hook ? `/api/hooks/${hook.id}` : null;

  const loadSecret = async (): Promise<string | null> => {
    if (!hook) return null;
    const res = await apiFetch(`/api/hooks/${hook.id}/secret`);
    if (!res.ok) return null;
    const body = (await res.json()) as { secret?: string };
    return body.secret ?? null;
  };

  const copyCurl = () => {
    if (!hook || !hookPath) return;
    void (async () => {
      const secret = await loadSecret();
      if (!secret) return;
      const url = `${window.location.origin}${hookPath}`;
      void navigator.clipboard?.writeText(
        `curl -X POST ${url} -H "content-type: application/json" -H "webhook-id: demo-delivery-1" -H "webhook-timestamp: $(date +%s)" -H "x-devflow-secret: ${secret}" -d '{"ping":true}'`,
      );
    })();
  };

  return (
    <Alert className="mb-3.5">
      <Clock size={16} className="shrink-0" />
      <span className="flex-1 text-[12.5px] text-muted-foreground">
        Waiting for its event source — it resumes automatically on delivery.
        {hook && hookPath && (
          <>
            <br />
            POST to <code className="font-mono text-foreground">{hookPath}</code>
            {" "}· secret <code className="font-mono text-foreground">{hook.secret}</code>
          </>
        )}
      </span>
      {hook && hookPath && (
        <Button size="sm" variant="ghost" onClick={copyCurl}>
          Copy curl example
        </Button>
      )}
    </Alert>
  );
}
