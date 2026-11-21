/**
 * Task 01 — rendering keys off artifact `kind`, never the node's kind. The
 * registry snapshot pins the built-in kinds; the component test renders an
 * unknown declarative node's panel and asserts both its markdown and diff
 * artifacts come through the registry (and no "isn't supported yet" fallback).
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import {
  artifactRenderers,
  fallbackArtifactRenderer,
  rendererForKind,
} from "@/components/flows/panels/artifacts/artifactRenderers";
import GenericDeclarativePanel from "@/components/flows/panels/genericDeclarativePanel";
import { NodePanelContext, type NodePanelContextValue } from "@/components/flows/panels/context";
import { resolveNodePanel } from "@/components/flows/panels/panelFactory";
import { queryKeys } from "@/constants/queryKeys";
import type { Artifact, FlowData, Node } from "@/types/flow";

const mdArtifact: Artifact = {
  id: "art-md",
  kind: "markdown",
  version: 1,
  status: "done",
  created_at: "2026-11-21T00:00:00.000Z",
};
const diffArtifact: Artifact = {
  id: "art-diff",
  kind: "diff",
  version: 1,
  status: "done",
  created_at: "2026-11-21T00:00:00.000Z",
};

const node: Node = {
  id: "node-1",
  node_key: "custom",
  type: "custom_def_key",
  kind: "custom_kind",
  status: "awaiting_approval",
  capabilities: { panelTitle: "Changelog bot", refinable: true },
  config: { prompt: "Summarize the release", model: "claude-sonnet-4" },
  artifacts: [mdArtifact, diffArtifact],
};

const flow: FlowData = {
  id: "flow-1",
  name: "Release changelog",
  status: "running",
  nodes: [node],
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
};

const context: NodePanelContextValue = {
  flow,
  node,
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
};

const renderPanel = (html: (q: QueryClient) => void): string => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  html(queryClient);
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(
        NodePanelContext.Provider,
        { value: context },
        createElement(GenericDeclarativePanel),
      ),
    ),
  );
};

describe("artifact renderer registry", () => {
  it("pins the four built-in kinds and the <pre> fallback", () => {
    expect(Object.keys(artifactRenderers).sort()).toEqual(["diff", "json", "markdown", "plan"]);
    expect(rendererForKind("markdown")).toBe(artifactRenderers.markdown);
    expect(rendererForKind("json")).toBe(artifactRenderers.json);
    expect(rendererForKind("diff")).toBe(artifactRenderers.diff);
    expect(rendererForKind("plan")).toBe(artifactRenderers.plan);
    // an unregistered kind still renders — via the existing <pre> fallback
    expect(rendererForKind("something_new")).toBe(fallbackArtifactRenderer);
  });

  it("resolves the generic panel as the fallback for an unknown declarative kind", () => {
    const workspace = resolveNodePanel(node);
    expect(workspace.panel).toBe(GenericDeclarativePanel);
    // the chat rail is capability-driven, so it survives the fallback resolution
    expect(workspace.chat).not.toBeNull();
  });
});

describe("generic declarative panel", () => {
  it("renders a markdown and a diff artifact by kind, with no fallback text", () => {
    const html = renderPanel((queryClient) => {
      queryClient.setQueryData(queryKeys.artifacts.detail(mdArtifact.id), {
        content: "# Changelog\nhello-md",
        meta: {},
      });
      queryClient.setQueryData(queryKeys.artifacts.detail(diffArtifact.id), {
        content: "diff --git a/x.txt b/x.txt\n--- a/x.txt\n+++ b/x.txt\n@@ -1 +1 @@\n-old\n+new",
        meta: {},
      });
    });

    // the markdown renderer (not a <pre>) produced the heading
    expect(html).toContain("<h1");
    expect(html).toContain("hello-md");
    // the diff renderer produced the per-file view
    expect(html).toContain("x.txt");
    // header + approval affordance come from capabilities / status
    expect(html).toContain("Changelog bot");
    expect(html).toContain("Approve");
    // no "isn't supported yet" branch, no empty state
    expect(html).not.toContain("supported yet");
    expect(html).not.toContain("No output yet");
  });
});
