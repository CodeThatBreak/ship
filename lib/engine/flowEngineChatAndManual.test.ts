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
import { beforeAll, describe, expect, it } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../../tests/helpers/testDatabase";

// Must run before any `db` import touches the connection — dynamic imports
// below execute in statement order after the static ones hoist.
assignTestDatabase();

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

// ── fixture: topic agent (json) → paragraph agent (markdown) ─────────────────

let TOPIC_ROW: { id: string };
let PARAGRAPH_ROW: { id: string };

beforeAll(async () => {
  await resetTestDatabase();
  await db.setSetting("default_harness", "stub"); // forMode("cloud") selects the stub
  TOPIC_ROW = must(
    await templateStore.createNodeTemplate({
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
  PARAGRAPH_ROW = must(
    await templateStore.createNodeTemplate({
      key: "paragraph_agent_fixture",
      name: "Paragraph agent fixture",
      kind: "agent",
      config: { mode: "plan", output: "markdown", prompt: "Write a paragraph on {{input.topic}}" },
    }),
    "paragraph agent row",
  );
});

const nodeStatus = async (flowId: string, key: string): Promise<string> =>
  must(
    await db.get<{ status: string }>(`SELECT status FROM nodes WHERE flow_id=$1 AND node_key=$2`, flowId, key),
    `node ${key} of ${flowId}`,
  ).status;

const recordedInput = async (flowId: string, key: string): Promise<Record<string, unknown>> => {
  const raw = must(
    await db.get<{ input: string | null }>(`SELECT input FROM nodes WHERE flow_id=$1 AND node_key=$2`, flowId, key),
    `recorded input of ${key}`,
  ).input;
  // JSONB column: the driver hands back a parsed object (a legacy TEXT row
  // still surfaces as its JSON string)
  const parsed: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${key} recorded input is not an object`);
  }
  // narrowed to a plain object; a cast records that the spread carries only
  // the keyset we asserted against
  return parsed as Record<string, unknown>;
};

/** One isolated flow on a two-agent-template: topic_agent → paragraph_agent.
 *  No start node (skipLint) and a manual flow trigger — nothing auto-runs. */
async function seedAgentFlow(index: number): Promise<string> {
  const templateId = await templateStore.create(
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
  await db.run(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    taskId, "jira", `CM-${index}`, "speechless test", "open", "task", "P2",
  );
  return flowEngine.create(taskId, "https://git.example.com/o/r", `chat-manual fixture ${index}`, {
    templateId,
  });
}

/** Poll the DB until the async engine bg work settles (or fail loudly). */
async function until(cond: () => boolean | Promise<boolean>, what: string): Promise<void> {
  for (let i = 0; i < 300; i++) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${what}`);
}

// ── tests ────────────────────────────────────────────────────────────────────

describe("sendChat — a refine turn obeys the terminal contract", () => {
  it("failed → chat feedback → done advances the edge: the next node starts with the topic", async () => {
    const flowId = await seedAgentFlow(1);
    // the topic agent failed its run (the model self-reported missing input)
    await db.run(
      `UPDATE nodes SET status='failed', updated_at=$1 WHERE flow_id=$2 AND node_key='topic_agent'`,
      db.now(), flowId,
    );
    expect(await nodeStatus(flowId, "topic_agent")).toBe("failed");
    stub.pushResult('{"topic":"react"}');
    stub.pushResult("React is a library for building UIs from components.");

    void flowEngine.chats.sendChat(flowId, "topic_agent", "pick react as topic");

    await until(
      async () => (await nodeStatus(flowId, "topic_agent")) === "done" && (await nodeStatus(flowId, "paragraph_agent")) === "done",
      "the refined node and its downstream successor",
    );
    // the inherited upstream value rides the untrusted-data fence (step 05
    // Q3): the body renders, then the fenced block carrying the topic
    expect(
      stub.prompts.some(
        (p) =>
          p.startsWith("Write a paragraph on") &&
          p.includes('<untrusted-data source="input.topic">') &&
          p.includes("\nreact\n"),
      ),
    ).toBe(true);
    expect((await recordedInput(flowId, "paragraph_agent")).topic).toBe("react");
  });

  it("a turn that misses the output contract again leaves the node failed — no advance", async () => {
    const flowId = await seedAgentFlow(2);
    await db.run(
      `UPDATE nodes SET status='failed', updated_at=$1 WHERE flow_id=$2 AND node_key='topic_agent'`,
      db.now(), flowId,
    );
    // the refine turn fails the contract, gets its one bounded self-heal
    // retry, and fails that too — the node goes back to failed
    stub.pushResult("no json here");
    stub.pushResult("still no json here");

    void flowEngine.chats.sendChat(flowId, "topic_agent", "pick react as topic");
    await until(async () => (await nodeStatus(flowId, "topic_agent")) === "failed", "the refined node to re-fail");

    expect(await nodeStatus(flowId, "paragraph_agent")).toBe("pending");
  });
});

describe("runNodeManual — agent nodes inherit the upstream input", () => {
  it("a manual start renders {{input.*}} from the merged upstream outputs", async () => {
    const flowId = await seedAgentFlow(3);
    // the topic agent finished with topic=react but the follow-up edge never
    // activated (the pre-fix chat stall) — the user starts the node manually
    await db.run(
      `UPDATE nodes SET status='done', output=$1, updated_at=$2 WHERE flow_id=$3 AND node_key='topic_agent'`,
      JSON.stringify({ topic: "react" }), db.now(), flowId,
    );
    stub.pushResult("React is a library for building UIs from components.");

    void flowEngine.runNodeManual(flowId, "paragraph_agent");

    await until(async () => (await nodeStatus(flowId, "paragraph_agent")) === "done", "the manual run");
    // the inherited upstream value rides the untrusted-data fence (step 05 Q3)
    expect(
      stub.prompts.some(
        (p) =>
          p.startsWith("Write a paragraph on") &&
          p.includes('<untrusted-data source="input.topic">') &&
          p.includes("\nreact\n"),
      ),
    ).toBe(true);
    expect((await recordedInput(flowId, "paragraph_agent")).topic).toBe("react");
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

const planNodeRow = async (flowId: string) =>
  must(
    await db.get<{ id: string; input: string | null }>(
      `SELECT id, input FROM nodes WHERE flow_id=$1 AND node_key=$2`,
      flowId,
      NODE_KEYS.PLAN,
    ),
    `plan node of ${flowId}`,
  );

const insertPlanArtifact = async (flowId: string, nodeId: string, version = 1): Promise<void> => {
  await db.run(
    `INSERT INTO artifacts (id, node_id, flow_id, kind, version, content, meta, status, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8)`,
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
async function seedPlanFlow(index: number): Promise<string> {
  const templateId = await templateStore.create(
    {
      name: `plan-retry fixture ${index}`,
      trigger: { type: "manual", task_type: "jira" },
      nodes: [{ key: NODE_KEYS.PLAN, nodeTemplateId: "nt_plan", trigger: { type: "manual" } }],
      edges: [],
    },
    { skipLint: true },
  );
  const taskId = `task_plan_retry_${index}`;
  await db.run(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    taskId, "jira", `PR-${index}`, "plan retry test", "open", "task", "P2",
  );
  return flowEngine.create(taskId, "https://git.example.com/o/r", `plan-retry fixture ${index}`, {
    templateId,
  });
}

const lifecycleMessages = async (flowId: string, nodeId: string): Promise<string[]> =>
  (
    await db.all<{ message: string }>(
      `SELECT message FROM events WHERE flow_id=$1 AND node_id=$2 AND type='lifecycle' ORDER BY created_at`,
      flowId,
      nodeId,
    )
  ).map((r) => r.message);

describe("retryNode — plan node chat replay", () => {
  it("replays a recorded turn via the chat refiner and lands awaiting_approval", async () => {
    const flowId = await seedPlanFlow(1);
    const plan = await planNodeRow(flowId);
    await insertPlanArtifact(flowId, plan.id);
    const recorded = PlanInput.parse({
      turnUserMessage: "move step 2 below step 1",
      previousStatus: "awaiting_approval",
      planTurnKind: PlanTurnKind.Whole,
      planThread: null,
      model: null,
    });
    await db.run(
      `UPDATE nodes SET status='failed', input=$1, updated_at=$2 WHERE id=$3`,
      JSON.stringify(recorded),
      db.now(),
      plan.id,
    );
    stub.pushResult(planTurnJson("Moved step 2 below step 1."));

    void flowEngine.retries.retryNode(flowId, NODE_KEYS.PLAN);

    await until(
      async () => (await nodeStatus(flowId, NODE_KEYS.PLAN)) === "awaiting_approval",
      "plan retry to finish",
    );
    expect(stub.prompts.length).toBeGreaterThan(0);
    expect(stub.prompts.some((p) => p.includes("move step 2 below step 1"))).toBe(true);
    expect(await lifecycleMessages(flowId, plan.id)).toContain(`retrying ${NODE_KEYS.PLAN}`);
  });

  it("with no recorded turn reverts to pending and emits plan chat ready", async () => {
    const flowId = await seedPlanFlow(2);
    const plan = await planNodeRow(flowId);
    await db.run(
      `UPDATE nodes SET status='failed', input=$1, updated_at=$2 WHERE id=$3`,
      JSON.stringify(PlanInput.parse({ turnUserMessage: null, previousStatus: null })),
      db.now(),
      plan.id,
    );

    void flowEngine.retries.retryNode(flowId, NODE_KEYS.PLAN);

    await until(
      async () => (await nodeStatus(flowId, NODE_KEYS.PLAN)) === "pending",
      "plan retry to revert to pending",
    );
    expect(await nodeStatus(flowId, NODE_KEYS.PLAN)).toBe("pending");
    expect(await lifecycleMessages(flowId, plan.id)).toContain(PLAN_CHAT_READY_LIFECYCLE);
  });

  it("with no recorded turn but an existing plan version reverts to awaiting_approval", async () => {
    const flowId = await seedPlanFlow(3);
    const plan = await planNodeRow(flowId);
    await insertPlanArtifact(flowId, plan.id);
    await db.run(
      `UPDATE nodes SET status='failed', input=$1, updated_at=$2 WHERE id=$3`,
      JSON.stringify(PlanInput.parse({ turnUserMessage: null, previousStatus: null })),
      db.now(),
      plan.id,
    );

    void flowEngine.retries.retryNode(flowId, NODE_KEYS.PLAN);

    await until(
      async () => (await nodeStatus(flowId, NODE_KEYS.PLAN)) === "awaiting_approval",
      "plan retry to revert to awaiting_approval",
    );
    expect(await nodeStatus(flowId, NODE_KEYS.PLAN)).toBe("awaiting_approval");
    expect(await lifecycleMessages(flowId, plan.id)).toContain(PLAN_CHAT_READY_LIFECYCLE);
  });
});
