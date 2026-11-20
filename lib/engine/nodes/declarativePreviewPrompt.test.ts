/**
 * Step 05 (prompt audit): the declarative agent/decision kinds publish a live
 * prompt preview through the shared assembly — the composed prompt a fresh
 * run would send, built by the same path `run()` uses so preview === run
 * bytes.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { assignTestDatabase, resetTestDatabase } from "../../../tests/helpers/testDatabase";

assignTestDatabase();

beforeAll(resetTestDatabase);

const { AgentTemplateNode } = await import("./kinds/agent/agentNode");
const { DecisionTemplateNode } = await import("./kinds/decision/decisionNode");
const { nodeRoles } = await import("./shared/nodeRoles");
import type { FlowCtx } from "./shared/nodeSharedExports";
import type { NodeRow } from "../../db/rows";

const now = () => new Date().toISOString();

const ctx = {
  flow: {
    id: "flw_preview",
    taskId: "task_preview",
    name: "declarative preview",
    status: "active",
    executionMode: "local",
    mrBranch: null,
    parentFlowId: null,
    createdAt: now(),
    updatedAt: now(),
  },
  task: {
    id: "task_preview",
    type: "generic",
    key: "TST-900",
    summary: "declarative preview",
    fields: {},
    status: "open",
    issueType: "task",
    priority: "P2",
  },
  repo: { defaultBranch: "main", localPath: "/tmp/fixture-hub" },
} as unknown as FlowCtx;

const nodeRow = (input: unknown): NodeRow =>
  ({
    id: "node_preview",
    flowId: "flw_preview",
    nodeKey: "classify",
    type: "agent",
    status: "pending",
    attemptId: null,
    agentId: null,
    agentRef: null,
    sessionId: null,
    label: null,
    config: null,
    joinMode: null,
    input,
    output: null,
    createdAt: now(),
    updatedAt: now(),
  }) as unknown as NodeRow;

const previewerOf = (def: unknown) => {
  const previewer = nodeRoles.promptPreviewerOf(def as Parameters<typeof nodeRoles.promptPreviewerOf>[0]);
  if (!previewer) throw new Error("the declarative def must publish a prompt preview");
  return previewer;
};

describe("declarative agent node previewPrompt", () => {
  it("returns the composed prompt a fresh run would send (body + contract directive)", async () => {
    const def = new AgentTemplateNode({
      id: "tpl_agent_preview",
      name: "Classify",
      description: null,
      config: {
        prompt: "Classify the ticket {{task.key}} for review.",
        output: "json",
        output_schema: { type: "object", properties: { label: { type: "string" } }, required: ["label"] },
      },
    });
    const preview = await previewerOf(def).previewPrompt(ctx, nodeRow(null), {});
    if (!preview) throw new Error("expected a preview");

    // the rendered body and the generated contract directive — run bytes
    expect(preview.assembly.body).toContain("Classify the ticket TST-900 for review.");
    expect(preview.assembly.final).toContain("RESPONSE FORMAT");
    expect(preview.assembly.final).toContain("one JSON object");
    expect(preview.assembly.final).toContain(preview.assembly.body);
    // the directive rides as the display contract block
    expect(preview.assembly.blocks.some((b) => b.kind === "contract")).toBe(true);
    // the configured prompt is the body source
    expect(preview.configBody).toContain("Classify the ticket");
  });

  it("a markdown-output agent appends no contract directive", async () => {
    const def = new AgentTemplateNode({
      id: "tpl_agent_markdown",
      name: "Summarize",
      description: null,
      config: { prompt: "Summarize {{task.key}}.", output: "markdown" },
    });
    const preview = await previewerOf(def).previewPrompt(ctx, nodeRow(null), {});
    if (!preview) throw new Error("expected a preview");
    expect(preview.assembly.blocks).toEqual([]);
    expect(preview.assembly.final).toBe(preview.assembly.body);
    expect(preview.assembly.final).toContain("Summarize TST-900.");
  });

  it("no configured prompt → no preview (nothing would be sent)", async () => {
    const def = new AgentTemplateNode({
      id: "tpl_agent_empty",
      name: "Blank",
      description: null,
      config: {},
    });
    expect(await previewerOf(def).previewPrompt(ctx, nodeRow(null), {})).toBeNull();
  });
});

describe("declarative decision node previewPrompt", () => {
  it("returns the agent-source decision prompt (fallback question, branch list, directive)", async () => {
    const def = new DecisionTemplateNode({
      id: "tpl_decision_preview",
      name: "Router",
      description: null,
      config: {
        source: "agent",
        question: "Pick the branch for {{task.key}}.",
        choices: [{ label: "ship", description: "all good" }, { label: "hold" }],
      },
    });
    const preview = await previewerOf(def).previewPrompt(ctx, nodeRow(null), {});
    if (!preview) throw new Error("expected a preview");

    expect(preview.assembly.final).toContain("Pick the branch for TST-900.");
    expect(preview.assembly.final).toContain("- ship: all good");
    expect(preview.assembly.final).toContain("RESPONSE FORMAT");
    expect(preview.assembly.final).toContain("Do not modify any files");
  });

  it("the inherited input rides the flow-state block like the run path passes it", async () => {
    const def = new DecisionTemplateNode({
      id: "tpl_decision_inherit",
      name: "Router",
      description: null,
      config: {
        source: "agent",
        question: "Decide.",
        choices: [{ label: "a" }, { label: "b" }],
      },
    });
    const preview = await previewerOf(def).previewPrompt(
      ctx,
      nodeRow({ upstream_field: "upstream-value", source: "agent" }),
      {},
    );
    if (!preview) throw new Error("expected a preview");
    expect(preview.assembly.final).toContain('"upstream_field": "upstream-value"');
  });
});
