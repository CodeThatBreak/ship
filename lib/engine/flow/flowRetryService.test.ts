import { testRun } from "@/tests/helpers/rawTestDb";
import { beforeAll, describe, expect, it } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../../../tests/helpers/testDatabase";

assignTestDatabase();

const { db } = await import("../../db/app");
const { FlowRetryService } = await import("./flowRetryService");
const { ValidationError } = await import("../../errors");
const { PLAN_CHAT_READY_LIFECYCLE } = await import("../nodes/kinds/plan/planRetryRevert");
const { NODE_KEYS } = await import("../constants/nodeKeys");
const { NODE_STATUS } = await import("../constants/nodeStatus");
import type { RetryHost } from "./types/retryHost";

type TriggerResult = import("../runtime/triggers/types/triggerGateway").TriggerResult;

const SKIP: TriggerResult = { started: false, skipped: true, reason: "skipped_duplicate_trigger" };

/**
 * FlowRetryService — the retry path's own contract (step-05 carve-out): the
 * fast-fail guards (non-retryable def, input parse), the `retry` claim whose
 * from-set is the step-06 duplicate fence (a running/waiting node or a busy
 * post-MR chain loses it atomically — the old ConflictError guards are gone),
 * the plan dead-end fix (no recorded turn ⇒ the declared `planRetryRevert`
 * transition + the chat-ready lifecycle event), and the step-05
 * prompt-rebuild coherence strip. The end-to-end retry flows are covered by
 * the engine tests (planRetryDeadEnd, promptRetryRebuild, sdlcHappyPath).
 */
const seedNode = async (flowId: string, nodeKey: string, type: string, status: string, input?: unknown): Promise<void> => {
  await testRun(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    `task_${flowId}`, "generic", flowId.toUpperCase(), "retry test", "open", "task", "P2",
  );
  await testRun(
    `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES ($1,$2,$3,$4,now(),now())`,
    flowId, `task_${flowId}`, "t", "active",
  );
  await testRun(
    `INSERT INTO nodes (id, flow_id, node_key, type, status, input, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,now(),now())`,
    db.uid("node_"), flowId, nodeKey, type, status, input === undefined ? null : JSON.stringify(input),
  );
};

const makeHost = (over: Partial<RetryHost> = {}): RetryHost => ({
  defOf: async () => ({ key: "build", retryable: true, capabilities: {}, parseInput: (x: unknown) => x }) as never,
  nodeStatus: async () => "failed",
  claimTrigger: async () => ({ started: true, attemptId: "attempt_1" }) as TriggerResult,
  transitionTrigger: async () => ({ started: true }) as TriggerResult,
  bg: () => {},
  ctx: async () => ({}) as never,
  advanceFrom: async () => {},
  postTerminal: async () => {},
  nodeConfigFor: async () => ({}),
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

  it("a running node loses the retry claim without a lifecycle emission", async () => {
    const flowId = "flw_retry_2";
    await seedNode(flowId, "build", "build", "running");
    let lifecycleCalls = 0;
    let bgCalls = 0;
    const service = new FlowRetryService(makeHost({
      claimTrigger: async () => SKIP,
      emitLifecycle: async () => { lifecycleCalls += 1; },
      bg: () => { bgCalls += 1; },
    }));
    const result = await service.retryNode(flowId, "build");
    // the claim's from-set is the fence (step 06) — a running node loses it
    // atomically and nothing runs
    expect(result).toEqual(SKIP);
    expect(lifecycleCalls).toBe(0);
    expect(bgCalls).toBe(0);
  });

  it("a node waiting for its event source loses the retry claim", async () => {
    const flowId = "flw_retry_3";
    await seedNode(flowId, "gate", "pipeline", "waiting");
    let lifecycleCalls = 0;
    let bgCalls = 0;
    const service = new FlowRetryService(makeHost({
      claimTrigger: async () => SKIP,
      emitLifecycle: async () => { lifecycleCalls += 1; },
      bg: () => { bgCalls += 1; },
    }));
    const result = await service.retryNode(flowId, "gate");
    expect(result).toEqual(SKIP);
    expect(lifecycleCalls).toBe(0);
    expect(bgCalls).toBe(0);
  });

  it("a busy post-MR chain loses the retry claim (the guard rides the claim)", async () => {
    const flowId = "flw_retry_4";
    await seedNode(flowId, "review", "review", "failed");
    const claimed: { key?: string; chainKeys?: readonly string[] } = {};
    let lifecycleCalls = 0;
    let bgCalls = 0;
    const service = new FlowRetryService(makeHost({
      claimTrigger: async (params) => {
        claimed.key = params.key;
        claimed.chainKeys = params.chainKeys;
        return SKIP;
      },
      emitLifecycle: async () => { lifecycleCalls += 1; },
      bg: () => { bgCalls += 1; },
    }));
    const result = await service.retryNode(flowId, "review");
    expect(result).toEqual(SKIP);
    expect(claimed.key).toBe("retry");
    expect(lifecycleCalls).toBe(0);
    expect(bgCalls).toBe(0);
  });

  it("a plan retry with no recorded turn applies the declared planRetryRevert + chat-ready event", async () => {
    const flowId = "flw_retry_5";
    await seedNode(flowId, NODE_KEYS.PLAN, "plan", "failed", {
      turnUserMessage: null,
      previousStatus: null,
    });
    const applied: { key?: string; toStatus?: string } = {};
    const events: string[] = [];
    const service = new FlowRetryService(makeHost({
      defOf: async () =>
        ({ key: "plan", retryable: true, capabilities: { chatMode: "plan" }, parseInput: (x: unknown) => x }) as never,
      transitionTrigger: async (params) => {
        applied.key = params.key;
        applied.toStatus = params.toStatus;
        return { started: true } as TriggerResult;
      },
      emitLifecycle: async (_flowId, _nodeKey, message) => {
        events.push(message);
      },
    }));
    await service.retryNode(flowId, NODE_KEYS.PLAN);
    expect(applied.key).toBe("planRetryRevert");
    // no previousStatus snapshot and no published plan → back to pending
    expect(applied.toStatus).toBe(NODE_STATUS.PENDING);
    expect(events).toContain(PLAN_CHAT_READY_LIFECYCLE);
  });

  it("a plan revert that loses the transition emits nothing and stays untouched", async () => {
    const flowId = "flw_retry_6";
    await seedNode(flowId, NODE_KEYS.PLAN, "plan", "failed", {
      turnUserMessage: null,
      previousStatus: null,
    });
    let lifecycleCalls = 0;
    let bgCalls = 0;
    const service = new FlowRetryService(makeHost({
      defOf: async () =>
        ({ key: "plan", retryable: true, capabilities: { chatMode: "plan" }, parseInput: (x: unknown) => x }) as never,
      transitionTrigger: async () => SKIP,
      emitLifecycle: async () => { lifecycleCalls += 1; },
      bg: () => { bgCalls += 1; },
    }));
    const result = await service.retryNode(flowId, NODE_KEYS.PLAN);
    expect(result).toEqual(SKIP);
    expect(lifecycleCalls).toBe(0);
    expect(bgCalls).toBe(0);
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
    for (const key of ["build", "review", "resolve", "pipeline"]) {
      expect(service.rebuildRetryInput({ key } as never, recorded)).toEqual({
        instructions: "focus on error handling",
        model: "gpt-x",
      });
    }
    // declarative kinds keep their recorded-prompt replay
    expect(service.rebuildRetryInput({ key: "topic_agent_fixture" } as never, recorded)).toEqual(recorded);
  });
});
