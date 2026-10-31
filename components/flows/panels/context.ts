"use client";
import { createContext, useContext } from "react";
import type { FlowData, Node } from "@/types/flow";
import type { ModelChoice } from "@/types/modelSpec";
import type { FeedEvent } from "@/components/chat/timeline";

/** What a panel may pass to an action: the action route's open body shape. */
export type ActionPayload = Record<string, unknown>;

/**
 * The node panel contract: everything the resolved panel (and its chat rail)
 * needs, provided once by `NodePanel` — panels take no props and read this
 * through `useNodePanel`. The workspace pieces (panel + chat) resolve from
 * `./panel-factory`; this context is only the shared surface they run on.
 */
export interface NodePanelContextValue {
  flow: FlowData;
  node: Node;
  /** POST /api/flows/:id/action — uses mutate (errors surface on `actionError`). */
  action: (a: string, b?: ActionPayload) => void;
  /** await when the caller must run logic only after the action succeeds */
  actionAsync: (a: string, b?: ActionPayload) => Promise<unknown>;
  actionPending: boolean;
  actionError: unknown;
  resetAction: () => void;
  retryAction: () => void;
  /** the flow's live event stream (BuildView's step-status rollup, the chat feed) */
  events: FeedEvent[];
  /** the composed model override consumed by run-start action payloads */
  model: string;
  /** the model picker's choice (the chat composer's selector writes it) */
  modelChoice: ModelChoice | null;
  setModelChoice: (choice: ModelChoice | null) => void;
}

export const NodePanelContext = createContext<NodePanelContextValue | null>(null);

/** The node panel's shared surface. Missing = a resolution bug: fail loudly. */
export function useNodePanel(): NodePanelContextValue {
  const context = useContext(NodePanelContext);
  if (!context) {
    throw new Error("useNodePanel: no NodePanelContext — this component must render inside NodePanel.");
  }
  return context;
}
