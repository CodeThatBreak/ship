/**
 * Task 17 — the "Retrigger pipeline" affordance on the CI-gate panel. The
 * button offers only when the gate's recorded output carries a pipeline id
 * AND the node sits at its failed terminal (a green or never-run gate has
 * nothing to retry; a live run owns the branch — the engine's `panelVerb`
 * fence would skip the click anyway); the click itself dispatches through
 * the same gateway-claimed action route the re-check uses (covered at the
 * seam by `tests/engine-overhaul/retriggerPipelineAction.test.ts`).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import PipelineView from "@/components/flows/panels/views/PipelineView";
import { NodePanelContext, type NodePanelContextValue } from "@/components/flows/panels/context";
import { FLOW_STATUS } from "@/constants/flow";
import type { FlowData, Node } from "@/types/flow";

const node: Node = {
  id: "node-1",
  node_key: "ci",
  type: "pipeline",
  status: FLOW_STATUS.FAILED,
  kind: "builtin",
  output: { pipelineId: 7, status: "failed", fixes: 2 },
  artifacts: [],
};

const flow: FlowData = {
  id: "flow-1",
  name: "Gate flow",
  status: "running",
  mr_url: "https://git.example.com/o/r/-/merge_requests/1",
  branches: [],
  task: {
    key: "REL-1",
    summary: "Gate",
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
      createElement(NodePanelContext.Provider, { value: context }, createElement(PipelineView)),
    ),
  );
};

describe("CI-gate panel — Retrigger pipeline affordance (task 17)", () => {
  it("offers Retrigger pipeline beside the re-check on a failed gate with a recorded pipeline", () => {
    const html = renderPanel(contextFor({}));
    expect(html).toContain("Retrigger pipeline");
    expect(html).toContain("Check pipeline");
  });

  it("offers no Retrigger pipeline on a green gate", () => {
    const html = renderPanel(contextFor({ status: FLOW_STATUS.DONE, output: { pipelineId: 7, status: "success", fixes: 2 } }));
    expect(html).not.toContain("Retrigger pipeline");
  });

  it("offers no Retrigger pipeline when the gate never recorded a pipeline id", () => {
    const html = renderPanel(contextFor({ output: { status: "failed", fixes: 0 } }));
    expect(html).not.toContain("Retrigger pipeline");
  });

  it("offers no Retrigger pipeline while the run is live — the run owns the branch", () => {
    const html = renderPanel(contextFor({ status: FLOW_STATUS.RUNNING }));
    expect(html).not.toContain("Retrigger pipeline");
  });
});
