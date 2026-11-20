import { beforeAll, describe, expect, it } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../../../tests/helpers/testDatabase";

assignTestDatabase();

const { db } = await import("../../db/app");
const { FlowRetryService } = await import("./flowRetryService");
const { ConflictError, ValidationError } = await import("../../errors");
const { PLAN_CHAT_READY_LIFECYCLE } = await import("../nodes/kinds/plan/planRetryRevert");
const { NODE_KEYS } = await import("../constants/nodeKeys");
import type { RetryHost } from "./types/retryHost";

/**
 * FlowRetryService — the retry path's own contract (step-05 carve-out): the
 * fast-fail guards (non-retryable def, running/waiting node, busy post-MR
 * chain), the plan dead-end fix (no recorded turn ⇒ the declared
 * `planRetryRevert` transition + the chat-ready lifecycle event), and the
 * step-05 prompt-rebuild coherence strip. The end-to-end retry flows are
 * covered by the engine tests (planRetryDeadEnd, promptRetryRebuild,
 * sdlcHappyPath).
 */
const seedNode = async (flowId: string, nodeKey: string, type: string, status: string, input?: unknown): Promise<void> => {
  await db.run(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    `task_${flowId}`, "generic", flowId.toUpperCase(), "retry test", "open", "task", "P2",
  );
  await db.run(
    `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES ($1,$2,$3,$4,now(),now())`,
    flowId, `task_${flowId}`, "t", "active",
  );
  await db.run(
    `INSERT INTO nodes (id, flow_id, node_key, type, status, input, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,now(),now())`,
    db.uid("node_"), flowId, nodeKey, type, status, input === undefined ? null : JSON.stringify(input),
  );
};

const makeHost = (over: Partial<RetryHost> = {}): RetryHost => ({
  defOf: async () => ({ key: "build", retryable: true, capabilities: {}, parseInput: (x: unknown) => x }) as never,
  nodeStatus: async () => "failed",
  claimNode: async () => "attempt_1",
  applyOrThrow: async () => {},
  bg: () => {},
  ctx: async () => ({}) as never,
  advanceFrom: async () => {},
  nodeConfigFor: async () => ({}),
  chainBusy: async () => false,
  isStepChild: async () => false,
  latestResourceArtifact: async () => undefined,
  emitLifecycle: async () => {},
  ...over,
});

describe("FlowRetryService", () => {
  beforeAll(async () => {
    await resetTestDatabase();
  });

  it("rejects a def that is not retryable", async () => {
    const flowId = "flw_retry_1";
    await seedNode(flowId, "agent", "agent", "failed");
    const service = new FlowRetryService(makeHost({
      defOf: async () => ({ key: "agent", retryable: false, capabilities: {}, parseInput: (x: unknown) => x }) as never,
    }));
    await expect(service.retryNode(flowId, "agent")).rejects.toThrow(ValidationError);
  });

  it("rejects a running node", async () => {
    const flowId = "flw_retry_2";
    await seedNode(flowId, "build", "build", "running");
    const service = new FlowRetryService(makeHost());
    await expect(service.retryNode(flowId, "build")).rejects.toThrow(ConflictError);
  });

  it("rejects a node waiting for its event source", async () => {
    const flowId = "flw_retry_3";
    await seedNode(flowId, "gate", "pipeline", "waiting");
    const service = new FlowRetryService(makeHost());
    await expect(service.retryNode(flowId, "gate")).rejects.toThrow(/waiting for its event source/);
  });

  it("rejects while the post-MR chain is busy", async () => {
    const flowId = "flw_retry_4";
    await seedNode(flowId, "review", "review", "failed");
    const service = new FlowRetryService(makeHost({ chainBusy: async () => true }));
    await expect(service.retryNode(flowId, "review")).rejects.toThrow(/pipeline\/review\/resolve run to finish/);
  });

  it("a plan retry with no recorded turn applies the declared planRetryRevert + chat-ready event", async () => {
    const flowId = "flw_retry_5";
    await seedNode(flowId, NODE_KEYS.PLAN, "plan", "failed", {
      turnUserMessage: null,
      previousStatus: null,
    });
    const applied: string[] = [];
    const events: string[] = [];
    const service = new FlowRetryService(makeHost({
      defOf: async () =>
        ({ key: "plan", retryable: true, capabilities: { chatMode: "plan" }, parseInput: (x: unknown) => x }) as never,
      applyOrThrow: async (_flowId, nodeKey, key) => {
        applied.push(`${nodeKey}:${key}`);
      },
      emitLifecycle: async (_flowId, _nodeKey, message) => {
        events.push(message);
      },
    }));
    await service.retryNode(flowId, NODE_KEYS.PLAN);
    expect(applied).toEqual([`${NODE_KEYS.PLAN}:planRetryRevert`]);
    expect(events).toContain(PLAN_CHAT_READY_LIFECYCLE);
  });

  it("strips the recorded prompt keys for the prompt-rebuilding kinds (step 05 coherence)", () => {
    const service = new FlowRetryService(makeHost());
    const recorded = {
      prompt: "the frozen final prompt from the failed run",
      promptIsBody: true,
      prompt_source: "modal",
      instructions: "focus on error handling",
      model: "gpt-x",
    };
    for (const key of ["build", "step_build", "review", "resolve", "pipeline"]) {
      expect(service.rebuildRetryInput({ key } as never, recorded)).toEqual({
        instructions: "focus on error handling",
        model: "gpt-x",
      });
    }
    // declarative kinds keep their recorded-prompt replay
    expect(service.rebuildRetryInput({ key: "topic_agent_fixture" } as never, recorded)).toEqual(recorded);
  });
});
