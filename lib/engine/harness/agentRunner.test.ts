/**
 * Agent run lifecycle: late-write guard, run-row closure, converse mode.
 */
import { testGet, testRun } from "@/tests/helpers/rawTestDb";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../../../tests/helpers/testDatabase";

assignTestDatabase();

const { db } = await import("../../db/app");
const { nodeSupport } = await import("@/lib/composition/container");
const { flowCtxHelper } = await import("../nodes/shared/runContext");
const { usageTracker } = await import("./usageTracker");
const { AgentRunner } = await import("./agentRunner/agentRunner");
const { RunSupersededError } = await import("../errors/runSupersededError");
const { AgentRunLookupError } = await import("../ports/agentErrors");
const { agentPortRegistry } = await import("../ports/agentPort");
const { config } = await import("../../config");
const { worktreeManager } = await import("../runtime/worktreeLifecycle");
const { engineParts } = await import("@/lib/composition/container");
const { TOKEN_MASK } = await import("../agentTools/utils/toolsPromptBlock");
import type {
  AgentPort,
  AgentRunHandle,
  AgentRunQuery,
  AgentRunResult,
  AgentStartSpec,
  AgentStreamCallbacks,
  AgentStreamOutcome,
} from "../ports/agentPort";
import type { FlowCtx } from "../nodes/shared/runContext/types/flowContext";

const now = () => new Date().toISOString();

class RunnerTestPort implements AgentPort {
  readonly kind = "runner-test";
  readonly label = "Runner test";
  readonly harness = "runner-test";
  readonly execMode = "cloud" as const;
  readonly fallbackModels: string[] = [];
  readonly listDiscount = 0;

  constructor(
    private readonly streamImpl: (
      handle: AgentRunHandle,
      callbacks?: AgentStreamCallbacks,
    ) => Promise<AgentStreamOutcome>,
  ) {}

  start(_spec: AgentStartSpec) {
    void _spec;
    return Promise.resolve({
      agentId: "agt_test",
      runId: `run_${Date.now()}`,
    });
  }

  stream(handle: AgentRunHandle, callbacks?: AgentStreamCallbacks): Promise<AgentStreamOutcome> {
    return this.streamImpl(handle, callbacks);
  }

  getRun(): Promise<AgentRunQuery> {
    return Promise.resolve({
      state: "unavailable",
      error: new AgentRunLookupError("stub", "run_stub"),
    });
  }
  cancel() {
    return Promise.resolve(false);
  }
  hasActiveRun() {
    return false;
  }
  releaseActiveRun() {}
  getUsage() {
    return Promise.resolve(null);
  }
  inspectSession() {
    return Promise.resolve(null);
  }
  listCatalog() {
    return Promise.resolve(null);
  }
  status() {
    return Promise.resolve({ configured: true });
  }
}

async function seed(status: string, index: number): Promise<{ ctx: FlowCtx; nodeId: string; flowId: string }> {
  const flowId = `flw_runner_test_${index}`;
  const nodeId = `node_runner_test_${index}`;
  const taskId = `task_runner_test_${index}`;
  await testRun(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    taskId,
    "generic",
    `RUN-${index}`,
    "agent runner test",
    "open",
    "story",
    "P2",
  );
  await testRun(
    `INSERT INTO flows (id, task_id, name, status, execution_mode, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    flowId,
    taskId,
    "runner test",
    "active",
    "cloud",
    now(),
    now(),
  );
  await testRun(
    `INSERT INTO nodes (id, flow_id, node_key, type, status, attempt_id, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    nodeId,
    flowId,
    "build",
    "build",
    status,
    status === "running" ? "att_runner_test" : null,
    now(),
    now(),
  );
  const ctx = {
    flow: {
      id: flowId,
      task_id: taskId,
      name: "runner test",
      status: "active",
      execution_mode: "cloud",
      mr_branch: null,
      parent_flow_id: null,
      created_at: now(),
      updated_at: now(),
    },
    task: {
      id: taskId,
      type: "generic",
      key: `RUN-${index}`,
      summary: "test",
      fields: {},
      status: "open",
      issueType: "story",
      priority: "P2",
    },
  } as unknown as FlowCtx;
  return { ctx, nodeId, flowId };
}

async function runRowStatus(runRef: string): Promise<string | undefined> {
  return (await testGet<{ status: string }>(`SELECT status FROM runs WHERE run_ref=$1`, runRef))?.status;
}

let supersedeDuringStream: string | null = null;
// task 22: when set, the port's stream emits these tool events before finishing
let toolScript: ((callbacks: AgentStreamCallbacks) => void) | null = null;

const runnerTestPort = new RunnerTestPort(async (_handle, callbacks) => {
  if (toolScript && callbacks) {
    toolScript(callbacks);
    toolScript = null;
  }
  if (supersedeDuringStream) {
    await testRun(
      `UPDATE nodes SET attempt_id=$1, updated_at=$2 WHERE id=$3`,
      "att_superseded",
      now(),
      supersedeDuringStream,
    );
    supersedeDuringStream = null;
  }
  return {
    result: { status: "finished", result: "ok" } satisfies AgentRunResult,
  };
});
agentPortRegistry.register(runnerTestPort);
await db.setSetting("default_harness", "runner-test");

const makeRunner = (usage: typeof usageTracker = usageTracker) =>
  new AgentRunner(flowCtxHelper, nodeSupport, usage, db, config, agentPortRegistry, worktreeManager);

describe("AgentRunner.executeRun", () => {
  beforeAll(async () => {
    await resetTestDatabase();
    // runnerTestPort is already registered at module scope; the registry is
    // process-wide and rejects duplicate kinds.
    await db.setSetting("default_harness", "runner-test");
  });

  it("throws RunSupersededError when the attempt token no longer matches", async () => {
    const { ctx, nodeId } = await seed("running", 1);
    supersedeDuringStream = nodeId;
    const runner = makeRunner();
    let runRef = "";
    await expect(
      runner.executeRun(
        ctx,
        nodeId,
        async () => {
          const started = await runnerTestPort.start({ prompt: "p", name: "n" });
          runRef = started.runId;
          return started;
        },
        "test run",
      ),
    ).rejects.toBeInstanceOf(RunSupersededError);
    expect(await runRowStatus(runRef)).toBe("finished");
  });

  it("skips the late-write guard when ownsNodeStatus is false", async () => {
    const { ctx, nodeId } = await seed("done", 2);
    const runner = makeRunner();
    const result = await runner.executeRun(
      ctx,
      nodeId,
      () => runnerTestPort.start({ prompt: "p", name: "n" }),
      "chat",
      { ownsNodeStatus: false },
    );
    expect(result.result.result).toBe("ok");
  });

  it("closes the run row as error when usage capture fails", async () => {
    const usage = {
      captureRunUsage: vi.fn().mockRejectedValue(new Error("usage down")),
      persistUsage: usageTracker.persistUsage.bind(usageTracker),
    };
    const { ctx, nodeId } = await seed("running", 3);
    const runner = makeRunner(usage as unknown as typeof usageTracker);
    let runRef = "";
    const result = await runner.executeRun(
      ctx,
      nodeId,
      async () => {
        const started = await runnerTestPort.start({ prompt: "p", name: "n" });
        runRef = started.runId;
        return started;
      },
      "test run",
    );
    expect(result.result.result).toBe("ok");
    expect(await runRowStatus(runRef)).toBe("finished");
  });
});

describe("AgentRunner.executeRun — the transcript capture (task 22)", () => {
  const TOKEN = "tok_capability_deadbeef";

  it("captures the streamed tool calls, capped and token-redacted, on the side-channel", async () => {
    const { ctx, nodeId } = await seed("running", 4);
    // the claim-minted capability token the run carries (step 08) — the
    // capture must mask it everywhere it echoes through tool args
    engineParts.attemptRegistry.mark(nodeId, "att_runner_test", TOKEN);
    toolScript = (callbacks) => {
      // start-ish emits never record
      callbacks.onTool?.("Bash", "started", { command: "npm test" }, "c1");
      callbacks.onTool?.("Bash", "completed", { command: `npm test --token=${TOKEN}` }, "c1");
      callbacks.onTool?.("create_change_request", "failed", { authorization: `Bearer ${TOKEN}` }, "c2");
      callbacks.onTool?.("read_flow_state", "completed", undefined, "c3");
    };

    try {
      const result = await makeRunner().executeRun(
        ctx,
        nodeId,
        () => runnerTestPort.start({ prompt: "p", name: "n" }),
        "test run",
      );

      const transcript = result.transcript;
      expect(transcript?.totalCalls).toBe(3);
      expect(transcript?.truncated).toBe(false);
      expect(transcript?.calls.map((c) => [c.name, c.status])).toEqual([
        ["Bash", "completed"],
        ["create_change_request", "failed"],
        ["read_flow_state", "completed"],
      ]);
      // the redaction proof: every echoed token is masked, none survives
      const allSummaries = transcript?.calls.map((c) => c.summary ?? "").join("\n") ?? "";
      expect(allSummaries).toContain(TOKEN_MASK);
      expect(allSummaries).not.toContain(TOKEN);
      // cloud emits carry no start timestamp — duration stays absent (local
      // pairing supplies it)
      expect(transcript?.calls[0]?.durationMs).toBeUndefined();
      // a call without args carries no summary
      expect(transcript?.calls[2]?.summary).toBeUndefined();
    } finally {
      toolScript = null;
      engineParts.attemptRegistry.clear(nodeId);
    }
  });
});
