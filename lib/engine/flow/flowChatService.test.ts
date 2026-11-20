import { beforeAll, describe, expect, it } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../../../tests/helpers/testDatabase";

assignTestDatabase();

const { db } = await import("../../db/app");
const { FlowChatService } = await import("./flowChatService");
const { CHAT_DECLINED } = await import("../nodes/shared/nodeRoles");
import type { ChatHost } from "./types/chatHost";

type TriggerResult = import("../runtime/triggers/types/triggerGateway").TriggerResult;

const SKIP: TriggerResult = { started: false, skipped: true, reason: "skipped_duplicate_trigger" };

/**
 * FlowChatService — the chat path's own contract (step-05 carve-out): the
 * `chatRefine` claim (whose atomic fence is the step-06 gateway door), the
 * §T4 role routing (decline without a refiner), the recorded user/assistant
 * messages, and the terminal contract (advance the template edges only when
 * THIS turn lands a NEW success terminal). The end-to-end chat flows are
 * covered by the engine tests (flowEngineChatAndManual, planChatToGate,
 * sdlcHappyPath).
 */
const seedFlow = async (flowId: string): Promise<void> => {
  await db.run(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    `task_${flowId}`, "generic", flowId.toUpperCase(), "chat test", "open", "task", "P2",
  );
  await db.run(
    `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES ($1,$2,$3,$4,now(),now())`,
    flowId, `task_${flowId}`, "t", "active",
  );
};

const makeHost = (over: Partial<ChatHost> = {}): ChatHost => ({
  defOf: async () => ({ key: "agent", capabilities: {} }) as never,
  nodeStatus: async () => "failed",
  claimTrigger: async () => ({ started: true, attemptId: "attempt_1" }) as TriggerResult,
  bg: () => {},
  ctx: async () => ({}) as never,
  advanceFrom: async () => {},
  ...over,
});

const assistantMessages = async (flowId: string): Promise<string[]> =>
  (await db.all<{ content: string }>(`SELECT content FROM messages WHERE flow_id=$1 AND role='assistant'`, flowId)).map(m => m.content);

describe("FlowChatService", () => {
  beforeAll(async () => {
    await resetTestDatabase();
  });

  it("declines a node whose def has no chat refiner and claims through chatRefine", async () => {
    const flowId = "flw_chat_1";
    await seedFlow(flowId);
    const claimed: string[] = [];
    const advanced: string[] = [];
    let bgBody: (() => Promise<void>) | undefined;
    const service = new FlowChatService(makeHost({
      claimTrigger: async (params) => {
        claimed.push(params.key);
        return { started: true, attemptId: "attempt_1" } as TriggerResult;
      },
      bg: (_flowId, _nodeKey, fn) => {
        bgBody = fn;
      },
      advanceFrom: async (_flowId, fromKey) => {
        advanced.push(fromKey);
      },
    }));
    await service.sendChat(flowId, "agent", "hello");
    expect(claimed).toEqual(["chatRefine"]);
    if (bgBody) await bgBody();
    expect(await assistantMessages(flowId)).toEqual([CHAT_DECLINED]);
    expect(advanced).toEqual([]);
  });

  it("returns the skip result without a background turn when the claim loses", async () => {
    const flowId = "flw_chat_4";
    await seedFlow(flowId);
    let bgCalls = 0;
    let advanced = 0;
    const service = new FlowChatService(makeHost({
      claimTrigger: async () => SKIP,
      bg: () => { bgCalls += 1; },
      advanceFrom: async () => { advanced += 1; },
    }));
    const result = await service.sendChat(flowId, "agent", "hello");
    expect(result).toEqual(SKIP);
    expect(bgCalls).toBe(0);
    expect(advanced).toBe(0);
  });

  it("advances the template edges when the turn lands a NEW success terminal", async () => {
    const flowId = "flw_chat_2";
    await seedFlow(flowId);
    const advanced: string[] = [];
    let bgBody: (() => Promise<void>) | undefined;
    let calls = 0;
    const service = new FlowChatService(makeHost({
      // pre-claim failed → the refine lands done
      nodeStatus: async () => (++calls === 1 ? "failed" : "done"),
      defOf: async () =>
        ({ key: "agent", capabilities: { refinable: true }, chat: async () => "x", turn: async () => "fixed" }) as never,
      bg: (_flowId, _nodeKey, fn) => {
        bgBody = fn;
      },
      advanceFrom: async (_flowId, fromKey) => {
        advanced.push(fromKey);
      },
    }));
    await service.sendChat(flowId, "agent", "make it pass");
    if (bgBody) await bgBody();
    expect(await assistantMessages(flowId)).toEqual(["fixed"]);
    expect(advanced).toEqual(["agent"]);
  });

  it("never re-advances an already-successful node's refine turn", async () => {
    const flowId = "flw_chat_3";
    await seedFlow(flowId);
    const advanced: string[] = [];
    let bgBody: (() => Promise<void>) | undefined;
    const service = new FlowChatService(makeHost({
      // pre-claim done → done-to-done refine must not re-advance
      nodeStatus: async () => "done",
      defOf: async () =>
        ({ key: "agent", capabilities: { refinable: true }, chat: async () => "x", turn: async () => "ok" }) as never,
      bg: (_flowId, _nodeKey, fn) => {
        bgBody = fn;
      },
      advanceFrom: async (_flowId, fromKey) => {
        advanced.push(fromKey);
      },
    }));
    await service.sendChat(flowId, "agent", "follow-up question");
    if (bgBody) await bgBody();
    expect(advanced).toEqual([]);
  });
});
