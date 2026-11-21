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
import { GenericDeclarativePanel } from "@/components/flows/panels/genericDeclarativePanel";
import PipelineView from "@/components/flows/panels/views/PipelineView";
import { NodePanelContext, type NodePanelContextValue } from "@/components/flows/panels/context";
import { resolveNodePanel } from "@/components/flows/panels/panelFactory";
import { FLOW_STATUS } from "@/constants/flow";
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

const renderPanel = (html: (q: QueryClient) => void, nodeOverride: Partial<Node> = {}): string => {
  const panelNode: Node = { ...node, ...nodeOverride };
  const context: NodePanelContextValue = {
    flow,
    node: panelNode,
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
  it("pins the ten built-in kinds and the <pre> fallback", () => {
    expect(Object.keys(artifactRenderers).sort()).toEqual([
      "diff", "failed_output", "json", "markdown", "pipeline", "plan", "resolve", "review", "transcript", "usage",
    ]);
    expect(rendererForKind("markdown")).toBe(artifactRenderers.markdown);
    expect(rendererForKind("json")).toBe(artifactRenderers.json);
    expect(rendererForKind("diff")).toBe(artifactRenderers.diff);
    expect(rendererForKind("plan")).toBe(artifactRenderers.plan);
    expect(rendererForKind("usage")).toBe(artifactRenderers.usage);
    expect(rendererForKind("transcript")).toBe(artifactRenderers.transcript);
    expect(rendererForKind("pipeline")).toBe(artifactRenderers.pipeline);
    expect(rendererForKind("review")).toBe(artifactRenderers.review);
    expect(rendererForKind("resolve")).toBe(artifactRenderers.resolve);
    expect(rendererForKind("failed_output")).toBe(artifactRenderers.failed_output);
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

describe("usage artifact renderer (task 21)", () => {
  it("renders the run's model, token split and cost from the stored payload", () => {
    const usageArtifact: Artifact = {
      id: "art-usage",
      kind: "usage",
      version: 1,
      status: "draft",
      created_at: "2026-11-21T00:00:00.000Z",
    };
    const html = renderPanel((queryClient) => {
      queryClient.setQueryData(queryKeys.artifacts.detail(usageArtifact.id), {
        content: JSON.stringify({
          model: "claude-sonnet-4",
          inputTokens: 1500,
          outputTokens: 300,
          cacheReadTokens: 800,
          cacheWriteTokens: 400,
          costCents: 12,
          estimated: true,
          durationMs: 42000,
        }),
      });
    }, { artifacts: [usageArtifact] });

    // the usage renderer (not the <pre> fallback) produced the structured view
    expect(html).toContain("Run usage");
    expect(html).toContain("claude-sonnet-4");
    expect(html).toContain("300 tok"); // uncached input (1500 − 1200 cached)
    expect(html).toContain("1k tok"); // cache read + write
    expect(html).toContain("$0.12"); // formatCostCents(12)
    expect(html).toContain("estimated");
    expect(html).toContain("42s");
    // the structured renderer produced the view — not the raw-body fallback
    expect(html).not.toContain("<pre");
  });

  it("falls back to the raw body when the content is not a usage payload", () => {
    const usageArtifact: Artifact = {
      id: "art-usage-bad",
      kind: "usage",
      version: 1,
      status: "draft",
      created_at: "2026-11-21T00:00:00.000Z",
    };
    const html = renderPanel((queryClient) => {
      queryClient.setQueryData(queryKeys.artifacts.detail(usageArtifact.id), {
        content: "not json",
      });
    }, { artifacts: [usageArtifact] });

    expect(html).toContain("not json");
    expect(html).not.toContain("Run usage");
  });
});

describe("transcript artifact renderer (task 22)", () => {
  const transcriptArtifact: Artifact = {
    id: "art-transcript",
    kind: "transcript",
    version: 1,
    status: "draft",
    created_at: "2026-11-21T00:00:00.000Z",
  };

  const renderTranscript = (detail: Record<string, unknown>): string =>
    renderPanel((queryClient) => {
      queryClient.setQueryData(queryKeys.artifacts.detail(transcriptArtifact.id), detail);
    }, { artifacts: [transcriptArtifact] });

  it("renders the capped call timeline with names, summaries and durations", () => {
    const html = renderTranscript({
      content: JSON.stringify({
        calls: [
          { name: "Bash", status: "completed", durationMs: 1200, summary: '{"command":"npm test"}' },
          { name: "create_change_request", status: "failed", summary: '{"branch":"changelog/x"}' },
        ],
        totalCalls: 2,
        truncated: false,
      }),
    });

    // the structured renderer produced the view — not the raw-body fallback
    expect(html).not.toContain("<pre");
    expect(html).toContain("Tool transcript");
    expect(html).toContain("2 calls");
    expect(html).toContain("Ran Bash");
    expect(html).toContain("&quot;command&quot;:&quot;npm test&quot;");
    expect(html).toContain("1s");
    // the failed call marks the timeline row
    expect(html).toContain("Failed create_change_request");
  });

  it("notes the cap when the log was truncated", () => {
    const html = renderTranscript({
      content: JSON.stringify({
        calls: [{ name: "Bash", status: "completed" }],
        totalCalls: 62,
        truncated: true,
      }),
    });

    expect(html).toContain("showing the first 1 of 62 calls");
  });

  it("falls back to the raw body when the content is not a transcript payload", () => {
    const html = renderTranscript({ content: "not json" });

    expect(html).toContain("not json");
    expect(html).not.toContain("Tool transcript");
  });
});

describe("pipeline artifact renderer (task 18)", () => {
  const pipelineArtifact: Artifact = {
    id: "art-pipeline",
    kind: "pipeline",
    version: 1,
    status: "done",
    created_at: "2026-11-21T00:00:00.000Z",
  };

  const renderPipeline = (detail: Record<string, unknown>): string =>
    renderPanel((queryClient) => {
      queryClient.setQueryData(queryKeys.artifacts.detail(pipelineArtifact.id), detail);
    }, { artifacts: [pipelineArtifact] });

  it("renders the status badge, the job list and the fix-run ledger from the snapshot", () => {
    const html = renderPipeline({
      content: JSON.stringify({
        status: "failed",
        pipelineId: 42,
        fixes: 2,
        jobs: [
          { id: 101, name: "rspec", status: "failed", manual: false },
          { id: 102, name: "deploy", status: "manual", manual: true },
        ],
        fixRuns: [
          { attempt: 1, summary: "bumped the flaky timeout" },
          { attempt: 2, summary: "pinned the lockfile" },
        ],
      }),
      meta: { nodeKey: "ci" },
    });

    // the structured renderer produced the view — not the raw-body fallback
    expect(html).not.toContain("<pre");
    // the status badge names the watched pipeline and its status
    expect(html).toContain("Pipeline #42 · failed");
    // the job snapshot with the manual-play marker
    expect(html).toContain("Jobs");
    expect(html).toContain("rspec");
    expect(html).toContain("deploy");
    expect(html).toContain("manual");
    // the fix-run ledger the gate spent
    expect(html).toContain("Fix runs");
    expect(html).toContain("bumped the flaky timeout");
    expect(html).toContain("pinned the lockfile");
    // the retrigger affordance rides the panel dispatcher to the recorded node
    expect(html).toContain("Retrigger pipeline");
  });

  it("renders the green banner for a success snapshot and no retrigger", () => {
    const html = renderPipeline({
      content: JSON.stringify({ status: "success", pipelineId: 7, fixes: 2, jobs: [], fixRuns: [] }),
    });

    expect(html).toContain("Pipeline #7 is green after 2 fix runs.");
    expect(html).not.toContain("Retrigger pipeline");
    expect(html).not.toContain("<pre");
  });

  it("offers no retrigger without the snapshot's node key", () => {
    const html = renderPipeline({
      content: JSON.stringify({ status: "failed", pipelineId: 42, fixes: 1, jobs: [], fixRuns: [] }),
    });

    expect(html).toContain("Pipeline #42 · failed");
    expect(html).not.toContain("Retrigger pipeline");
  });

  it("falls back to the raw body when the content is not a pipeline snapshot", () => {
    const html = renderPipeline({ content: "not json" });

    expect(html).toContain("not json");
    expect(html).not.toContain("Pipeline #");
    expect(html).not.toContain("Retrigger pipeline");
  });
});

describe("review artifact renderer (task 19)", () => {
  const reviewArtifact: Artifact = {
    id: "art-review",
    kind: "review",
    version: 1,
    status: "done",
    created_at: "2026-11-21T00:00:00.000Z",
  };

  const renderReview = (detail: Record<string, unknown>): string =>
    renderPanel((queryClient) => {
      queryClient.setQueryData(queryKeys.artifacts.detail(reviewArtifact.id), detail);
    }, { artifacts: [reviewArtifact] });

  it("renders the published comment threads through the shared ThreadList", () => {
    const html = renderReview({
      content: JSON.stringify({
        comments: [
          { file: "src/a.ts", line: 12, body: "Unused variable." },
          { body: "Overall the error handling is thin." },
        ],
      }),
      meta: { posted: 2, mrIid: 21, review_verdict: "approve" },
    });

    // the structured renderer produced the view — not the raw-body fallback
    expect(html).not.toContain("<pre");
    expect(html).toContain("Discussion threads");
    expect(html).toContain("2 open");
    expect(html).toContain("Unused variable.");
    expect(html).toContain("Overall the error handling is thin.");
    // the file:line projection rides the note header
    expect(html).toContain("src/a.ts:12");
    // the verdict badge (the meta projection)
    expect(html).toContain("approve");
  });

  it("falls back to the raw body when the content is not a review payload", () => {
    const html = renderReview({ content: "not json" });

    expect(html).toContain("not json");
    expect(html).not.toContain("Discussion threads");
  });
});

describe("resolve artifact renderer (task 19)", () => {
  const resolveArtifact: Artifact = {
    id: "art-resolve",
    kind: "resolve",
    version: 1,
    status: "done",
    created_at: "2026-11-21T00:00:00.000Z",
  };

  const renderResolve = (detail: Record<string, unknown>): string =>
    renderPanel((queryClient) => {
      queryClient.setQueryData(queryKeys.artifacts.detail(resolveArtifact.id), detail);
    }, { artifacts: [resolveArtifact] });

  it("renders the summary and the per-comment decision ledger from the meta", () => {
    const html = renderResolve({
      content: "Fixed the two open threads.",
      meta: {
        summary: "Fixed the two open threads.",
        decisions: [
          { id: "gl_1", action: "fixed", resolve: true, reply: "Extracted the helper." },
          { id: "gl_2", action: "wontfix", resolve: false, note: "intentional" },
        ],
      },
    });

    // the structured renderer produced the view — not the raw-body fallback
    expect(html).not.toContain("<pre");
    expect(html).toContain("Fixed the two open threads.");
    expect(html).toContain("Comment decisions");
    expect(html).toContain("gl_1");
    expect(html).toContain("fixed");
    expect(html).toContain("Extracted the helper.");
    expect(html).toContain("wontfix");
    expect(html).toContain("thread stays open");
    expect(html).toContain("intentional");
  });

  it("falls back to the raw body when the meta carries no ledger", () => {
    const html = renderResolve({ content: "plain run notes", meta: {} });

    expect(html).toContain("plain run notes");
    expect(html).not.toContain("Comment decisions");
  });
});

describe("failed_output artifact renderer (task 20)", () => {
  const failedArtifact: Artifact = {
    id: "art-failed",
    kind: "failed_output",
    version: 1,
    status: "draft",
    created_at: "2026-11-21T00:00:00.000Z",
  };

  const renderFailed = (detail: Record<string, unknown>): string =>
    renderPanel((queryClient) => {
      queryClient.setQueryData(queryKeys.artifacts.detail(failedArtifact.id), detail);
    }, { artifacts: [failedArtifact] });

  it("renders the schema violations and the raw response head from the stored payload", () => {
    const html = renderFailed({
      content: '{"cost": "free", "note": "here is your estimate"',
      meta: {
        code: "schema_mismatch",
        budget: 2,
        issues: [
          { path: "cost", message: "Invalid input: expected number, received string" },
          { path: "", message: "unterminated JSON text" },
        ],
      },
    });

    // the structured renderer produced the view — not the raw-body fallback
    expect(html).toContain("Failed output");
    expect(html).toContain("schema_mismatch");
    expect(html).toContain("2 feedback retries spent");
    expect(html).toContain("cost");
    expect(html).toContain("Invalid input: expected number, received string");
    expect(html).toContain("root");
    expect(html).toContain("unterminated JSON text");
    // the raw response head the run actually produced
    expect(html).toContain("&quot;cost&quot;: &quot;free&quot;");
  });

  it("falls back to the raw body when the meta carries no violations ledger", () => {
    const html = renderFailed({ content: "the raw bad response", meta: {} });

    expect(html).toContain("the raw bad response");
    expect(html).not.toContain("Failed output");
  });
});

describe("generic declarative panel — in-flow reconfiguration (task 05)", () => {
  it("offers Configure for a pending node", () => {
    const html = renderPanel(() => undefined, { status: "pending" });
    expect(html).toContain("Configure");
  });

  it("offers Configure for a failed node", () => {
    const html = renderPanel(() => undefined, { status: "failed" });
    expect(html).toContain("Configure");
  });

  it("offers no Configure for a running node (the engine rejects the edit)", () => {
    const html = renderPanel(() => undefined, { status: "running" });
    expect(html).not.toContain("Configure");
  });

  it("offers no Configure for a done node", () => {
    const html = renderPanel(() => undefined, { status: "done" });
    expect(html).not.toContain("Configure");
  });
});

describe("built-in PipelineView — unchanged after the PipelineStatusBody swap (task 18)", () => {
  const gateNode: Node = {
    ...node,
    node_key: "ci",
    type: "pipeline",
    kind: "builtin",
    status: FLOW_STATUS.FAILED,
    artifacts: [],
    output: { pipelineId: 7, status: "failed", fixes: 2 },
  };
  const gateFlow: FlowData = {
    ...flow,
    mr_url: "https://git.example.com/o/r/-/merge_requests/1",
    branches: [],
  };

  const renderView = (nodeOverride: Partial<Node>): string => {
    const context: NodePanelContextValue = {
      flow: gateFlow,
      node: { ...gateNode, ...nodeOverride },
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
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(NodePanelContext.Provider, { value: context }, createElement(PipelineView)),
      ),
    );
  };

  it("matches the pre-refactor snapshot on a failed gate with a recorded pipeline", () => {
    const html = renderView({});
    expect(html).toMatchSnapshot();
    // the footer keeps both affordances, the body keeps its empty state
    expect(html).toContain("Retrigger pipeline");
    expect(html).toContain("Check pipeline");
    expect(html).toContain("No pipeline fix runs yet.");
  });

  it("matches the pre-refactor snapshot on a green gate", () => {
    const html = renderView({ status: FLOW_STATUS.DONE, output: { pipelineId: 7, status: "success", fixes: 2 } });
    expect(html).toMatchSnapshot();
    // the moved green banner renders through the shared body, byte-identical
    expect(html).toContain("Pipeline #7 is green after 2 fix runs.");
  });
});
