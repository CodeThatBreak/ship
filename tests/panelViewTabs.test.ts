import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import BuildView from "@/components/flows/panels/views/components/BuildView";
import PipelineView from "@/components/flows/panels/views/components/PipelineView";
import ResolveView from "@/components/flows/panels/views/components/ResolveView";
import ReviewView from "@/components/flows/panels/views/components/ReviewView";
import { NodePanelContext, type NodePanelContextValue } from "@/components/flows/panels/context";
import type { FlowData, Node } from "@/types/flow";

const node: Node = {
  id: "node-1",
  nodeKey: "step",
  type: "custom",
  status: "done",
  artifacts: [],
};

const flow: FlowData = {
  id: "flow-1",
  name: "Tabbed flow",
  status: "running",
  branches: [],
  task: {
    key: "REL-1",
    summary: "Tabs",
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

const renderPanel = (Panel: ComponentType, context: NodePanelContextValue): string => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(NodePanelContext.Provider, { value: context }, createElement(Panel)),
    ),
  );
};

const cases: {
  name: string;
  Panel: ComponentType;
  context: NodePanelContextValue;
  tabs: string[];
  initialContent: string;
}[] = [
  {
    name: "Pipeline",
    Panel: PipelineView,
    context: contextFor({ type: "pipeline", status: "done", output: { pipelineId: 7, status: "success" } }),
    tabs: ["Runs", "Usage"],
    initialContent: "No pipeline fix runs yet.",
  },
  {
    name: "Review",
    Panel: ReviewView,
    context: contextFor({ type: "review" }),
    tabs: ["Comments", "Usage"],
    initialContent: "Review runs after the merge request is created.",
  },
  {
    name: "Resolve",
    Panel: ResolveView,
    context: contextFor({ type: "resolve" }),
    tabs: ["Result", "Usage"],
    initialContent: "Nothing resolved yet.",
  },
  {
    name: "Build",
    Panel: BuildView,
    context: contextFor({ type: "build", status: "awaiting_approval" }),
    tabs: ["Code diff", "Steps", "Usage"],
    initialContent: "No changes yet.",
  },
];

describe("built-in panel view tabs", () => {
  it.each(cases)("$name exposes its primary view and Usage", ({ name, Panel, context, tabs, initialContent }) => {
    const html = renderPanel(Panel, context);

    expect(html).toContain(`aria-label="${name} views"`);
    for (const tab of tabs) {
      expect(html).toContain(`>${tab}<`);
    }
    expect((html.match(/role="tab"/g) ?? []).length).toBe(tabs.length);
    expect(html).toContain(initialContent);
  });

  it("keeps the build approval actions in the shell footer", () => {
    const html = renderPanel(BuildView, contextFor({ type: "build", status: "awaiting_approval" }));

    expect(html).toContain("Accept &amp; create MR");
    expect(html).toContain("Code diff");
    expect(html).toContain("Steps");
    expect(html).toContain("Usage");
  });
});
