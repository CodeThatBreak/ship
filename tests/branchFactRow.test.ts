/**
 * Task 09 — branch/change_request fact rows in the generic panel. The shared
 * row renders any branch fact (status badge, name, `MR !iid ↗` link); the
 * generic declarative panel renders the flow's branch facts through it and
 * the change_request fact as the MR link; BuildView keeps its exact DOM after
 * swapping its inline row for the shared component (snapshot).
 */
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { BranchFactRow } from "@/components/shared/BranchFactRow";
import { GenericDeclarativePanel } from "@/components/flows/panels/genericDeclarativePanel";
import BuildView from "@/components/flows/panels/views/BuildView";
import { NodePanelContext, type NodePanelContextValue } from "@/components/flows/panels/context";
import type { BranchRow, FlowData, Node } from "@/types/flow";

const branchDone: BranchRow = {
  id: "branch-1",
  flowId: "flow-1",
  name: "devflow/build-login",
  title: "Login form",
  status: "done",
  mrUrl: "https://git.example.com/mrs/12",
  mrIid: 12,
  order: 0,
};

const branchAwaiting: BranchRow = {
  id: "branch-2",
  flowId: "flow-1",
  name: "devflow/build-signup",
  title: "Signup form",
  status: "awaiting_approval",
  order: 1,
};

const node: Node = {
  id: "node-1",
  nodeKey: "custom",
  type: "custom_def_key",
  kind: "custom_kind",
  status: "done",
  capabilities: { panelTitle: "Changelog bot", refinable: true },
  config: { prompt: "Summarize the release" },
  artifacts: [],
};

const flow: FlowData = {
  id: "flow-1",
  name: "Release changelog",
  status: "running",
  branches: [branchDone, branchAwaiting],
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

const contextFor = (flowOverride: Partial<FlowData>, nodeOverride: Partial<Node> = {}): NodePanelContextValue => ({
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

const renderPanelBody = (body: ComponentType, context: NodePanelContextValue): string => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(NodePanelContext.Provider, { value: context }, createElement(body)),
    ),
  );
};

describe("BranchFactRow", () => {
  it("renders the status badge, the title/name and the MR link", () => {
    const html = renderToStaticMarkup(
      createElement(BranchFactRow, {
        name: branchDone.name,
        status: branchDone.status,
        title: branchDone.title,
        mrUrl: branchDone.mrUrl,
        mrIid: branchDone.mrIid,
      }),
    );
    expect(html).toContain("Login form");
    expect(html).toContain("devflow/build-login");
    expect(html).toContain(">done</");
    expect(html).toContain('href="https://git.example.com/mrs/12"');
    expect(html).toContain("MR !12");
    // the link opens in a new tab
    expect(html).toContain('target="_blank"');
  });

  it("renders the git name as the title fallback and no MR link without a url", () => {
    const html = renderToStaticMarkup(
      createElement(BranchFactRow, { name: branchAwaiting.name, status: branchAwaiting.status }),
    );
    expect(html).toContain("devflow/build-signup");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("MR !");
  });

  it("marks a failed status badge destructive", () => {
    const html = renderToStaticMarkup(
      createElement(BranchFactRow, { name: "devflow/x", status: "failed" }),
    );
    expect(html).toContain("destructive");
  });

  it("renders detail and trailing slots inside the row", () => {
    const html = renderToStaticMarkup(
      createElement(BranchFactRow, {
        name: "devflow/x",
        status: "done",
        detail: createElement("div", null, "row detail"),
        trailing: createElement("span", null, "row trailing"),
      }),
    );
    expect(html).toContain("row detail");
    expect(html).toContain("row trailing");
  });
});

describe("generic declarative panel — branch/change_request facts (task 09)", () => {
  it("renders each branch fact through the shared row", () => {
    const html = renderPanelBody(GenericDeclarativePanel, contextFor({}));
    expect(html).toContain("Branches");
    expect(html).toContain("Login form");
    expect(html).toContain("devflow/build-login");
    expect(html).toContain('href="https://git.example.com/mrs/12"');
    expect(html).toContain("Signup form");
    expect(html).toContain("awaiting approval");
  });

  it("renders the flow-level change_request fact as the MR link", () => {
    const html = renderPanelBody(
      GenericDeclarativePanel,
      contextFor({ branches: [], mrUrl: "https://git.example.com/mrs/7", mrIid: 7, mrBranch: "devflow/build-x" }),
    );
    expect(html).toContain("MR !7");
    expect(html).toContain('href="https://git.example.com/mrs/7"');
    expect(html).toContain("devflow/build-x");
  });

  it("renders nothing branch-shaped without facts", () => {
    const html = renderPanelBody(GenericDeclarativePanel, contextFor({ branches: [] }));
    expect(html).not.toContain("Branches");
    expect(html).not.toContain("MR !");
    // the panel's own empty state still shows
    expect(html).toContain("No output yet");
  });
});

describe("BuildView — unchanged after the shared-row swap (task 09)", () => {
  it("matches the pre-refactor snapshot", () => {
    const html = renderPanelBody(BuildView, contextFor({}, { status: "awaiting_approval" }));
    expect(html).toMatchSnapshot();
    // the rows still carry the build-specific affordances through the slots
    expect(html).toContain("Accept &amp; create MR");
    expect(html).toContain("MR !12");
  });
});
