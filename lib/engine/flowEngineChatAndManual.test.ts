/**
 * Regression tests for the two trigger paths that stalled flow
 * flow_mvy6u61u0000dmzr (agent-node → agent-node chain):
 *
 *  - `sendChat`: a refine turn that lands the node on a NEW success terminal
 *    (failed → done via chat feedback) rides the same terminal contract as
 *    `retryNode` — the template edges advance and the next node starts. An
 *    already-terminal node never re-advances.
 *  - `runNodeManual`: with no explicit input, an `inheritsParentInput` def
 *    (agent, …) takes the merged upstream outputs — `{{input.*}}` renders in
 *    the prompt exactly like the engine's auto start.
 *
 * Real engine + real template rows; agent runs are hermetic through a stub
 * agent port (cloud mode). Runs against an isolated temp SQLite DB:
 * DATABASE_PATH is read lazily by lib/config.ts, so setting it before the
 * first `db` import isolates the singleton (AGENTS.md §1 — never a real
 * database).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Must run before any `db` import touches the connection — dynamic imports
// below execute in statement order after the static ones hoist.
process.env.DATABASE_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "devflow-chat-manual-")),
  "test.db",
);

const { db } = await import("../db/app");
const { flowEngine } = await import("./flowEngine");
const { templateStore } = await import("./templates/templateStore");
const { agentPortRegistry } = await import("./ports/agentPort");
const { NODE_KEYS } = await import("./constants/nodeKeys");
const { PlanInput } = await import("./nodes/kinds/plan/schema");
const { PlanTurnKind } = await import("./nodes/kinds/plan/constants/planTurn");
const { PLAN_CHAT_READY_LIFECYCLE } = await import("./nodes/kinds/plan/planRetryRevert");
import type {
  AgentPort,
  AgentRunQuery,
  AgentRunUsage,
  AgentStartSpec,
  AgentStarted,
  AgentStreamOutcome,
} from "./ports/agentPort";

/** A required row: throws instead of a `!` assertion (AGENTS.md §3.4). */
function must<T>(row: T | undefined, what: string): T {
  if (row == null) throw new Error(`missing row: ${what}`);
  return row;
}

// ── stub agent port (hermetic runs; result texts queue per stream call) ──────

class StubAgentPort implements AgentPort {
  readonly kind = "stub-chat";
  readonly label = "Stub chat";
  readonly execMode = "cloud" as const;
  readonly harness = "stub";
  readonly fallbackModels = [];
  readonly listDiscount = 0;
  /** start prompts in call order — the rendered final prompt, verbatim */
  readonly prompts: string[] = [];
  /** finished result texts, popped per stream() call; the last repeats */
  private readonly results: string[] = [];
  private counter = 0;

  pushResult(result: string): void {
    this.results.push(result);
  }

  /** Pop the next queued text; the last one repeats when the queue empties. */
  private nextResult(): string {
    const next = this.results.shift();
    if (next == null) throw new Error("stub agent stream called with an empty results queue");
    if (this.results.length === 0) this.results.push(next);
    return next;
  }

  async start(spec: AgentStartSpec): Promise<AgentStarted> {
    this.prompts.push(spec.prompt);
    this.counter += 1;
    return { agentId: `agt_stub_${this.counter}`, runId: `run_stub_${this.counter}` };
  }

  async stream(): Promise<AgentStreamOutcome> {
    return { result: { status: "finished", result: this.nextResult() } };
  }

  async getRun(): Promise<AgentRunQuery> {
    return { state: "running" };
  }

  async cancel(): Promise<boolean> {
    return false;
  }

  hasActiveRun(): boolean {
    return false;
  }

  releaseActiveRun(): void {}

  async getUsage(): Promise<AgentRunUsage | null> {
    return null;
  }

  async inspectSession(): Promise<{ completed: boolean; text: string } | null> {
    return null;
  }

  async listCatalog(): Promise<null> {
    return null;
  }

  async status(): Promise<{ configured: boolean }> {
    return { configured: true };
  }
}

const stub = new StubAgentPort();
agentPortRegistry.register(stub);
db.setSetting("default_harness", "stub"); // forMode("cloud") selects the stub

// ── fixture: topic agent (json) → paragraph agent (markdown) ─────────────────

const TOPIC_ROW = must(
  templateStore.createNodeTemplate({
    key: "topic_agent_fixture",
    name: "Topic agent fixture",
    kind: "agent",
    config: {
      mode: "plan",
      prompt: "You have to return a single topic",
      output: "json",
      output_schema: {
        type: "object",
        properties: { topic: { type: "string" } },
        required: ["topic"],
      },
    },
  }),
  "topic agent row",
);

const PARAGRAPH_ROW = must(
  templateStore.createNodeTemplate({
    key: "paragraph_agent_fixture",
    name: "Paragraph agent fixture",
    kind: "agent",
    config: { mode: "plan", output: "markdown", prompt: "Write a paragraph on {{input.topic}}" },
  }),
  "paragraph agent row",
);

const nodeStatus = (flowId: string, key: string): string =>
  must(
    db.get<{ status: string }>(`SELECT status FROM nodes WHERE flow_id=? AND node_key=?`, flowId, key),
    `node ${key} of ${flowId}`,
  ).status;

const recordedInput = (flowId: string, key: string): Record<string, unknown> => {
  const raw = must(
    db.get<{ input: string | null }>(`SELECT input FROM nodes WHERE flow_id=? AND node_key=?`, flowId, key),
    `recorded input of ${key}`,
  ).input;
  if (typeof raw !== "string" || !raw.trim()) throw new Error(`${key} recorded no input`);
  const parsed: unknown = JSON.parse(raw);
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${key} recorded input is not an object`);
  }
  // narrowed to a plain object; a cast records that the spread carries only
  // the keyset we asserted against
  return parsed as Record<string, unknown>;
};

/** One isolated flow on a two-agent-template: topic_agent → paragraph_agent.
 *  No start node (skipLint) and a manual flow trigger — nothing auto-runs. */
function seedAgentFlow(index: number): string {
  const templateId = templateStore.create(
    {
      name: `chat-manual fixture ${index}`,
      trigger: { type: "manual", task_type: "jira" },
      nodes: [
        { key: "topic_agent", nodeTemplateId: TOPIC_ROW.id, trigger: { type: "auto" } },
        { key: "paragraph_agent", nodeTemplateId: PARAGRAPH_ROW.id, trigger: { type: "auto" } },
      ],
      edges: [{ from: "topic_agent", to: "paragraph_agent", kind: "next" }],
    },
    { skipLint: true },
  );
  const taskId = `task_chat_manual_${index}`;
  db.run(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES (?,?,?,?,?,?,?)`,
    taskId, "jira", `CM-${index}`, "speechless test", "open", "task", "P2",
  );
  return flowEngine.create(taskId, "https://git.example.com/o/r", `chat-manual fixture ${index}`, {
    templateId,
  });
}

/** Poll the DB until the async engine bg work settles (or fail loudly). */
async function until(cond: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 300; i++) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${what}`);
}

// ── tests ────────────────────────────────────────────────────────────────────

describe("sendChat — a refine turn obeys the terminal contract", () => {
  it("failed → chat feedback → done advances the edge: the next node starts with the topic", async () => {
    const flowId = seedAgentFlow(1);
    // the topic agent failed its run (the model self-reported missing input)
    db.run(
      `UPDATE nodes SET status='failed', updated_at=? WHERE flow_id=? AND node_key='topic_agent'`,
      db.now(), flowId,
    );
    expect(nodeStatus(flowId, "topic_agent")).toBe("failed");
    stub.pushResult('{"topic":"react"}');
    stub.pushResult("React is a library for building UIs from components.");

    flowEngine.sendChat(flowId, "topic_agent", "pick react as topic");

    await until(
      () => nodeStatus(flowId, "topic_agent") === "done" && nodeStatus(flowId, "paragraph_agent") === "done",
      "the refined node and its downstream successor",
    );
    expect(stub.prompts.some((p) => p.startsWith("Write a paragraph on react"))).toBe(true);
    expect(recordedInput(flowId, "paragraph_agent").topic).toBe("react");
  });

  it("a turn that misses the output contract again leaves the node failed — no advance", async () => {
    const flowId = seedAgentFlow(2);
    db.run(
      `UPDATE nodes SET status='failed', updated_at=? WHERE flow_id=? AND node_key='topic_agent'`,
      db.now(), flowId,
    );
    // the refine turn fails the contract, gets its one bounded self-heal
    // retry, and fails that too — the node goes back to failed
    stub.pushResult("no json here");
    stub.pushResult("still no json here");

    flowEngine.sendChat(flowId, "topic_agent", "pick react as topic");
    await until(() => nodeStatus(flowId, "topic_agent") === "failed", "the refined node to re-fail");

    expect(nodeStatus(flowId, "paragraph_agent")).toBe("pending");
  });
});

describe("runNodeManual — agent nodes inherit the upstream input", () => {
  it("a manual start renders {{input.*}} from the merged upstream outputs", async () => {
    const flowId = seedAgentFlow(3);
    // the topic agent finished with topic=react but the follow-up edge never
    // activated (the pre-fix chat stall) — the user starts the node manually
    db.run(
      `UPDATE nodes SET status='done', output=?, updated_at=? WHERE flow_id=? AND node_key='topic_agent'`,
      JSON.stringify({ topic: "react" }), db.now(), flowId,
    );
    stub.pushResult("React is a library for building UIs from components.");

    flowEngine.runNodeManual(flowId, "paragraph_agent");

    await until(() => nodeStatus(flowId, "paragraph_agent") === "done", "the manual run");
    expect(stub.prompts.some((p) => p.startsWith("Write a paragraph on react"))).toBe(true);
    expect(recordedInput(flowId, "paragraph_agent").topic).toBe("react");
  });
});

// ── plan node retry (F2) ─────────────────────────────────────────────────────

const planStep = (id: string, title: string) => ({
  id,
  title,
  detail: "d",
  files: ["f.ts"],
  branch: null as string | null,
});

const validPlanPayload = {
  markdown: "# Plan (refined)",
  steps: [planStep("s1", "First"), planStep("s2", "Second")],
};

const planTurnJson = (reply: string) =>
  JSON.stringify({ reply, plan: validPlanPayload });

const planNodeRow = (flowId: string) =>
  must(
    db.get<{ id: string; input: string | null }>(
      `SELECT id, input FROM nodes WHERE flow_id=? AND node_key=?`,
      flowId,
      NODE_KEYS.PLAN,
    ),
    `plan node of ${flowId}`,
  );

const insertPlanArtifact = (flowId: string, nodeId: string, version = 1): void => {
  db.run(
    `INSERT INTO artifacts (id, node_id, flow_id, kind, version, content, meta, status, created_at)
     VALUES (?,?,?,?,?,?,?,'draft',?)`,
    `art_plan_${flowId}_${version}`,
    nodeId,
    flowId,
    "plan",
    version,
    "# Plan",
    JSON.stringify({ steps: validPlanPayload.steps, branches: [] }),
    db.now(),
  );
};

/** Isolated flow with a single manual plan node — nothing auto-runs. */
function seedPlanFlow(index: number): string {
  const templateId = templateStore.create(
    {
      name: `plan-retry fixture ${index}`,
      trigger: { type: "manual", task_type: "jira" },
      nodes: [{ key: NODE_KEYS.PLAN, nodeTemplateId: "nt_plan", trigger: { type: "manual" } }],
      edges: [],
    },
    { skipLint: true },
  );
  const taskId = `task_plan_retry_${index}`;
  db.run(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES (?,?,?,?,?,?,?)`,
    taskId, "jira", `PR-${index}`, "plan retry test", "open", "task", "P2",
  );
  return flowEngine.create(taskId, "https://git.example.com/o/r", `plan-retry fixture ${index}`, {
    templateId,
  });
}

const lifecycleMessages = (flowId: string, nodeId: string): string[] =>
  db
    .all<{ message: string }>(
      `SELECT message FROM events WHERE flow_id=? AND node_id=? AND type='lifecycle' ORDER BY created_at`,
      flowId,
      nodeId,
    )
    .map((r) => r.message);

describe("retryNode — plan node chat replay", () => {
  it("replays a recorded turn via the chat refiner and lands awaiting_approval", async () => {
    const flowId = seedPlanFlow(1);
    const plan = planNodeRow(flowId);
    insertPlanArtifact(flowId, plan.id);
    const recorded = PlanInput.parse({
      turnUserMessage: "move step 2 below step 1",
      previousStatus: "awaiting_approval",
      planTurnKind: PlanTurnKind.Whole,
      planThread: null,
      model: null,
    });
    db.run(
      `UPDATE nodes SET status='failed', input=?, updated_at=? WHERE id=?`,
      JSON.stringify(recorded),
      db.now(),
      plan.id,
    );
    stub.pushResult(planTurnJson("Moved step 2 below step 1."));

    flowEngine.retryNode(flowId, NODE_KEYS.PLAN);

    await until(
      () => nodeStatus(flowId, NODE_KEYS.PLAN) === "awaiting_approval",
      "plan retry to finish",
    );
    expect(stub.prompts.length).toBeGreaterThan(0);
    expect(stub.prompts.some((p) => p.includes("move step 2 below step 1"))).toBe(true);
    expect(lifecycleMessages(flowId, plan.id)).toContain(`retrying ${NODE_KEYS.PLAN}`);
  });

  it("with no recorded turn reverts to pending and emits plan chat ready", () => {
    const flowId = seedPlanFlow(2);
    const plan = planNodeRow(flowId);
    db.run(
      `UPDATE nodes SET status='failed', input=?, updated_at=? WHERE id=?`,
      JSON.stringify(PlanInput.parse({ turnUserMessage: null, previousStatus: null })),
      db.now(),
      plan.id,
    );

    flowEngine.retryNode(flowId, NODE_KEYS.PLAN);

    expect(nodeStatus(flowId, NODE_KEYS.PLAN)).toBe("pending");
    expect(lifecycleMessages(flowId, plan.id)).toContain(PLAN_CHAT_READY_LIFECYCLE);
  });

  it("with no recorded turn but an existing plan version reverts to awaiting_approval", () => {
    const flowId = seedPlanFlow(3);
    const plan = planNodeRow(flowId);
    insertPlanArtifact(flowId, plan.id);
    db.run(
      `UPDATE nodes SET status='failed', input=?, updated_at=? WHERE id=?`,
      JSON.stringify(PlanInput.parse({ turnUserMessage: null, previousStatus: null })),
      db.now(),
      plan.id,
    );

    flowEngine.retryNode(flowId, NODE_KEYS.PLAN);

    expect(nodeStatus(flowId, NODE_KEYS.PLAN)).toBe("awaiting_approval");
    expect(lifecycleMessages(flowId, plan.id)).toContain(PLAN_CHAT_READY_LIFECYCLE);
  });
});
