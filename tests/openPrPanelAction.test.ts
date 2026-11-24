/**
 * Task 12 — the "Open PR" panel action. The generic declarative panel offers
 * the direct `create_change_request` affordance when a branch fact exists for
 * the verb to target (the verb's own required-fact contract is the
 * capability — it fails loudly without one) and the node sits in a terminal
 * status the engine's `panelVerb` fence accepts. The `effects` declaration
 * gates only the automatic after-approval dispatch, never this manual button.
 * The click itself dispatches through the same gateway-claimed action route
 * the approval uses (covered at the seam by
 * `tests/engine-overhaul/panelVerbAction.test.ts`).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { GenericDeclarativePanel } from "@/components/flows/panels/components/node/GenericDeclarativePanel";
import { NodePanelContext, type NodePanelContextValue } from "@/components/flows/panels/context";
import { FLOW_STATUS } from "@/constants/flow";
import type { BranchRow, FlowData, Node } from "@/types/flow";

const branchRow: BranchRow = {
  id: "branch-1",
  flowId: "flow-1",
  name: "changelog/2026-47",
  title: "Release changelog",
  status: "done",
  order: 0,
};

const node: Node = {
  id: "node-1",
  nodeKey: "changelog",
  type: "custom_def_key",
  kind: "custom_kind",
  status: FLOW_STATUS.DONE,
  capabilities: { panelTitle: "Changelog bot" },
  config: { prompt: "Summarize the release" },
  artifacts: [],
};

const flow: FlowData = {
  id: "flow-1",
  name: "Release changelog",
  status: "running",
  branches: [branchRow],
  task: {
    key: "REL-1",
    summary: "Changelog",
    status: "done",
    issueType: "task",
    priority: "medium",
    prdText: "",
    figmaUrls: [],
    externalUrl: "",
  },
  nodes: [node],
};

const contextFor = (nodeOverride: Partial<Node>, flowOverride: Partial<FlowData> = {}): NodePanelContextValue => ({
  flow: { ...flow, ...flowOverride },
  node: { ...node, ...nodeOverride },
  action: () => undefined,
  actionAsync: async () => undefined,
  actionPending: false,
  actionError: null,
  resetAction: () => undefined,
  retryAction: () => undefined,
  events: [],
  model: "",
  modelChoice: null,
  setModelChoice: () => undefined,
});

const renderPanel = (context: NodePanelContextValue): string => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(NodePanelContext.Provider, { value: context }, createElement(GenericDeclarativePanel)),
    ),
  );
};

describe("generic declarative panel — Open PR affordance (task 12)", () => {
  it("offers Open PR when a branch fact exists and the node is terminal", () => {
    const html = renderPanel(contextFor({}));
    expect(html).toContain("Open PR");
  });

  it("offers Open PR from the approved and failed terminals too", () => {
    expect(renderPanel(contextFor({ status: FLOW_STATUS.APPROVED }))).toContain("Open PR");
    expect(renderPanel(contextFor({ status: FLOW_STATUS.FAILED }))).toContain("Open PR");
  });

  it("offers no Open PR without a branch fact (the verb would refuse loudly)", () => {
    const html = renderPanel(contextFor({}, { branches: [] }));
    expect(html).not.toContain("Open PR");
  });

  it("offers no Open PR while the run is live — the run owns the branch", () => {
    expect(renderPanel(contextFor({ status: FLOW_STATUS.RUNNING }))).not.toContain("Open PR");
    expect(
      renderPanel(contextFor({ status: FLOW_STATUS.AWAITING_APPROVAL })),
    ).not.toContain("Open PR");
    expect(renderPanel(contextFor({ status: FLOW_STATUS.PENDING }))).not.toContain("Open PR");
  });
});
