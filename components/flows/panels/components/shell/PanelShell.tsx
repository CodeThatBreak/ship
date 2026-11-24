"use client";
import { Clock, Square } from "lucide-react";
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
import { errorMessageOf, errorCodeOf } from "@/hooks/fetchJson";
import { API_ERROR_CODE, SKIPPED_DUPLICATE_TRIGGER_COPY } from "@/constants/api";
import { CostChip } from "./CostChip";
import { PanelErrorAlert } from "./PanelErrorAlert";
import { WaitBanner } from "./WaitBanner";
import { useNodePanel } from "../../context";
import { isAgenticNode } from "../../utils/isAgenticNode";
import { panelTitle } from "../../utils/panelTitle";

/**
 * Shared panel layout matching the Plan panel: a sticky header (title, status,
 * cost, actions), a scrollable body, and a fixed footer for the node's
 * primary actions. Every non-plan node renders through this so the cockpit
 * feels like one consistent surface.
 */
export function PanelShell({
  node, headerEnd, runningLabel = "Agent is working…", footer, children, flow, hideFailed, hideCost,
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
  /** nodes whose usage/cost is already shown in a tab hide the header cost tooltip */
  hideCost?: boolean;
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
  // a skipped duplicate trigger (step 06) is not a failure — the node is
  // already running, so it surfaces as friendly notice without a Retry
  const actionSkipped =
    errorCodeOf(actionError) === API_ERROR_CODE.SKIPPED_DUPLICATE_TRIGGER;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* sticky header */}
      <div className="flex items-center gap-2.5 px-5 py-3 border-b border-border shrink-0">
        <h2 className="m-0 text-[15px]">{panelTitle(node)}</h2>
        <Badge className={statusVariantOf(node.status)} variant={isFailedStatus(node.status) ? "destructive" : undefined}>
          <span className="size-1.5 rounded-full bg-current" />
          {node.status.replace(/_/g, " ")}
        </Badge>
        {!hideCost && <CostChip node={node} />}
        <div className="flex-1" />
        {headerEnd}
      </div>

      {/* scrollable content */}
      <ScrollArea className="flex-1">
        <div className="px-5 py-4">
        {actionSkipped && (
          <Alert className="mb-3.5">
            <Clock size={16} className="shrink-0" />
            <span className="flex-1">{SKIPPED_DUPLICATE_TRIGGER_COPY}</span>
            <Button size="sm" variant="ghost" onClick={() => resetAction()}>
              Dismiss
            </Button>
          </Alert>
        )}
        {!actionSkipped && actionMessage && (
          <PanelErrorAlert
            title="Action failed"
            description={actionMessage}
            onRetry={() => retryAction()}
            onDismiss={() => resetAction()}
          />
        )}
        {!hideFailed && node.status === FLOW_STATUS.FAILED && (
          <PanelErrorAlert
            title="This step failed"
            description="Check the activity feed for details."
            retryPending={actionPending}
            onRetry={() => action(FLOW_ACTION.RETRY, { nodeKey: node.nodeKey })}
          />
        )}
        {node.status === FLOW_STATUS.WAITING && <WaitBanner flow={cockpitFlow} node={node} />}
        {/* Agentic nodes already surface their running state in the chat rail
            (and swap the composer's send button for a stop button), so the
            centered "agent is working" block would be a duplicate here. */}
        {node.status === FLOW_STATUS.RUNNING && !isAgenticNode(node) && (
          <div className="flex flex-col items-center justify-center text-center px-5 py-8 gap-2">
            <Spinner className="size-[22px] border-[3px]" />
            <p className="text-muted-foreground text-sm font-medium m-0">{runningLabel}</p>
            <p className="text-muted-foreground text-xs m-0">Watch the activity feed →</p>
            <Button
              size="sm"
              variant="ghost"
              className="mt-1"
              disabled={actionPending}
              onClick={() => action(FLOW_ACTION.CANCEL, { nodeKey: node.nodeKey })}
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
