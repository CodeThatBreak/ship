/**
 * The agent node's panel is `AgentView` (panelFactory's PANEL_BY_KIND), not
 * `GenericDeclarativePanel` — so it needs the same "Open PR" affordance: the
 * verb's own required-fact contract is the capability (a branch fact must
 * exist — the verb fails loudly without one) and the node must sit in a
 * terminal the engine's `panelVerb` fence accepts. The `effects` declaration
 * gates only the automatic after-approval dispatch, never this manual button.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import AgentView from "@/components/flows/panels/views/agentView/AgentView";
import { NodePanelContext, type NodePanelContextValue } from "@/components/flows/panels/context";
import { FLOW_STATUS } from "@/constants/flow";
import type { Artifact, BranchRow, FlowData, Node } from "@/types/flow";

const branchRow: BranchRow = {
  id: "branch-1",
  flowId: "flow-1",
  name: "bugfix/a11y-6988-00wghu",
  title: "A11Y-6988",
  status: "building",
  order: 0,
};

const node: Node = {
  id: "node-1",
  nodeKey: "agent_node",
  type: "nt_agent",
  kind: "agent",
  status: FLOW_STATUS.DONE,
  capabilities: { panelTitle: "Agent node" },
  config: { output: "markdown", prompt: "fix the bug" },
  artifacts: [],
};

const flow: FlowData = {
  id: "flow-1",
  name: "A11Y-6988 flow",
  status: "active",
  branches: [branchRow],
  task: {
    key: "A11Y-6988",
    summary: "Accessibility fix",
    status: "open",
    issueType: "task",
    priority: "medium",
    prdText: "",
    figmaUrls: [],
    externalUrl: "",
  },
  nodes: [node],
};

const contextFor = (
  nodeOverride: Partial<Node>,
  flowOverride: Partial<FlowData> = {},
): NodePanelContextValue => ({
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
      createElement(NodePanelContext.Provider, { value: context }, createElement(AgentView)),
    ),
  );
};

describe("agent node panel — output version labels", () => {
  const outputArtifacts: Artifact[] = [1, 2].map((version) => ({
    id: `art_${version}`,
    kind: "markdown",
    version,
    status: "done",
    createdAt: `2026-01-0${version}T00:00:00.000Z`,
  }));

  it("labels output versions as runs, not v1/v2", () => {
    const html = renderPanel(contextFor({ artifacts: outputArtifacts }));
    expect(html).toContain("Run 1");
    expect(html).toContain("Run 2");
    expect(html).not.toContain("v1");
    expect(html).not.toContain("v2");
  });
});

describe("agent node panel — Open PR affordance", () => {
  it("offers Open PR on a terminal node with a branch fact — no declaration needed", () => {
    expect(renderPanel(contextFor({}))).toContain("Open PR");
  });

  it("offers Open PR from the approved and failed terminals too", () => {
    expect(renderPanel(contextFor({ status: FLOW_STATUS.APPROVED }))).toContain("Open PR");
    expect(renderPanel(contextFor({ status: FLOW_STATUS.FAILED }))).toContain("Open PR");
  });

  it("offers no Open PR without a branch fact (the verb would refuse loudly)", () => {
    expect(renderPanel(contextFor({}, { branches: [] }))).not.toContain("Open PR");
  });

  it("says Push changes once the branch has an MR", () => {
    const html = renderPanel(
      contextFor({}, { branches: [{ ...branchRow, mrUrl: "https://gitlab.example/mr/7", mrIid: 7 }] }),
    );
    expect(html).toContain("Push changes");
    expect(html).not.toContain("Open PR");
  });

  it("says Push changes when the flow already has an MR", () => {
    const html = renderPanel(contextFor({}, { mrUrl: "https://gitlab.example/mr/9", mrIid: 9 }));
    expect(html).toContain("Push changes");
    expect(html).not.toContain("Open PR");
  });

  it("offers no Open PR while the run is live — the run owns the branch", () => {
    expect(renderPanel(contextFor({ status: FLOW_STATUS.RUNNING }))).not.toContain("Open PR");
    expect(renderPanel(contextFor({ status: FLOW_STATUS.AWAITING_APPROVAL }))).not.toContain("Open PR");
    expect(renderPanel(contextFor({ status: FLOW_STATUS.PENDING }))).not.toContain("Open PR");
  });
});
