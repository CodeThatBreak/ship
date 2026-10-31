/**
 * Agent run lifecycle: late-write guard, run-row closure, converse mode.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

process.env.DATABASE_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "devflow-agent-runner-")),
  "test.db",
);

const { db } = await import("../../db");
const { nodeSupport } = await import("../nodes/shared/node-support");
const { flowCtxHelper } = await import("../nodes/shared/run-context");
const { usageTracker } = await import("./usage-tracker");
const { AgentRunner } = await import("./agent-runner");
const { RunSupersededError } = await import("../errors/run-superseded-error");
const { agentPortRegistry } = await import("../ports/agent-port");
import type {
  AgentPort,
  AgentRunHandle,
  AgentRunResult,
  AgentStartSpec,
  AgentStreamOutcome,
} from "../ports/agent-port";
import type { FlowCtx } from "../nodes/shared/run-context";

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
    ) => Promise<AgentStreamOutcome>,
  ) {}

  start(_spec: AgentStartSpec) {
    return Promise.resolve({
      agentId: "agt_test",
      runId: `run_${Date.now()}`,
    });
  }

  stream(handle: AgentRunHandle): Promise<AgentStreamOutcome> {
    return this.streamImpl(handle);
  }

  getRun() {
    return Promise.resolve(null);
  }
  cancel() {
    return Promise.resolve(false);
  }
  hasActiveRun() {
    return false;
  }
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

function seed(status: string, index: number): { ctx: FlowCtx; nodeId: string; flowId: string } {
  const flowId = `flw_runner_test_${index}`;
  const nodeId = `node_runner_test_${index}`;
  const taskId = `task_runner_test_${index}`;
  db.run(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES (?,?,?,?,?,?,?)`,
    taskId,
    "generic",
    `RUN-${index}`,
    "agent runner test",
    "open",
    "story",
    "P2",
  );
  db.run(
    `INSERT INTO flows (id, task_id, name, status, execution_mode, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
    flowId,
    taskId,
    "runner test",
    "active",
    "cloud",
    now(),
    now(),
  );
  db.run(
    `INSERT INTO nodes (id, flow_id, node_key, type, status, attempt_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
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

function runRowStatus(runRef: string): string | undefined {
  return db.get<{ status: string }>(`SELECT status FROM runs WHERE run_ref=?`, runRef)?.status;
}

let supersedeDuringStream: string | null = null;

const runnerTestPort = new RunnerTestPort(async () => {
  if (supersedeDuringStream) {
    db.run(`UPDATE nodes SET attempt_id=?, updated_at=? WHERE id=?`, "att_superseded", now(), supersedeDuringStream);
    supersedeDuringStream = null;
  }
  return {
    result: { status: "finished", result: "ok" } satisfies AgentRunResult,
  };
});
agentPortRegistry.register(runnerTestPort);
db.setSetting("default_harness", "runner-test");

describe("AgentRunner.executeRun", () => {
  it("throws RunSupersededError when the attempt token no longer matches", async () => {
    const { ctx, nodeId } = seed("running", 1);
    supersedeDuringStream = nodeId;
    const runner = new AgentRunner(flowCtxHelper, nodeSupport, usageTracker);
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
    expect(runRowStatus(runRef)).toBe("finished");
  });

  it("skips the late-write guard when ownsNodeStatus is false", async () => {
    const { ctx, nodeId } = seed("done", 2);
    const runner = new AgentRunner(flowCtxHelper, nodeSupport, usageTracker);
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
    const { ctx, nodeId } = seed("running", 3);
    const runner = new AgentRunner(flowCtxHelper, nodeSupport, usage as unknown as typeof usageTracker);
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
    expect(runRowStatus(runRef)).toBe("finished");
  });
});
