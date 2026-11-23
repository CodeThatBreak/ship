import { testRun } from "@/tests/helpers/rawTestDb";
import { beforeAll, describe, expect, it } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../../../tests/helpers/testDatabase";

assignTestDatabase();

const { db } = await import("../../db/app");
const { FlowApprovalService } = await import("./flowApprovalService");
const { ConflictError, ValidationError } = await import("../../errors");
const { NODE_STATUS } = await import("../constants/nodeStatus");

/**
 * FlowApprovalService — the approval paths' own contract (step-02 carve-out):
 * the declared `approve` transition (whose from-set is the step-06 duplicate
 * fence), the shared release-downstream block, and the guard rejections. The end-to-end approve flows are covered
 * by the engine tests (sdlcHappyPath, stepFlowManager's approveChildStep,
 * flowEngine's guard tests).
 */
type ApprovalHost = import("./types/approvalHost").ApprovalHost;
type TriggerResult = import("../runtime/triggers/types/triggerGateway").TriggerResult;

const SKIP: TriggerResult = { started: false, skipped: true, reason: "skipped_duplicate_trigger" };

const seedNode = async (flowId: string, nodeKey: string, status: string): Promise<void> => {
  await testRun(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    `task_${flowId}`, "generic", flowId.toUpperCase(), "approval test", "open", "task", "P2",
  );
  await testRun(
    `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES ($1,$2,$3,$4,now(),now())`,
    flowId, `task_${flowId}`, "t", "active",
  );
  await testRun(
    `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES ($1,$2,$3,'agent',$4,now(),now())`,
    db.uid("node_"), flowId, nodeKey, status,
  );
};

const seedPlanArtifact = async (flowId: string, id: string, meta: unknown = null): Promise<void> => {
  await testRun(
    `INSERT INTO artifacts (id, node_id, flow_id, kind, version, content, meta, status, created_at)
     VALUES ($1,(SELECT id FROM nodes WHERE flow_id=$2 AND node_key='plan'),$2,'plan',1,'# plan',$3::jsonb,'draft',now())`,
    id, flowId, meta === null ? null : JSON.stringify(meta),
  );
};

const makeHost = (over: Partial<ApprovalHost> = {}): ApprovalHost => ({
  keyOfRole: async () => "plan",
  defOf: async () => ({ builtinApproval: false, capabilities: {} }) as never,
  graph: async () => null,
  ctx: async () => { throw new Error("not used"); },
  latestResourceArtifact: async () => undefined,
  transitionTrigger: async () => ({ started: true }) as TriggerResult,
  chain: { approveBuild: async () => ({ started: true }) as TriggerResult },
  emitLifecycle: async () => {},
  bg: () => {},
  advanceFrom: async () => {},
  runEffect: async () => false,
  ...over,
});

describe("FlowApprovalService", () => {
  beforeAll(async () => {
    await resetTestDatabase();
  });

  it("approvePlan throws when there is no plan artifact to approve", async () => {
    const flowId = "flw_ap_0";
    await seedNode(flowId, "plan", NODE_STATUS.PENDING);
    let transitionCalls = 0;
    const service = new FlowApprovalService(makeHost({
      transitionTrigger: async () => {
        transitionCalls += 1;
        return { started: true } as TriggerResult;
      },
    }));
    await expect(service.approvePlan(flowId)).rejects.toThrow(/no plan to approve/);
    // the missing plan is a loud error BEFORE the transition door is touched
    expect(transitionCalls).toBe(0);
  });

  it("approvePlan skips a plan that is not awaiting approval without touching artifacts", async () => {
    const flowId = "flw_ap_1";
    await seedNode(flowId, "plan", NODE_STATUS.PENDING);
    await seedPlanArtifact(flowId, "art_skip_1");
    const service = new FlowApprovalService(makeHost({
      latestResourceArtifact: async () =>
        (await db.prisma.artifact.findUnique({
          where: { id: "art_skip_1" },
          select: { id: true, content: true, meta: true },
        })) as never,
      transitionTrigger: async () => SKIP,
    }));
    const result = await service.approvePlan(flowId);
    expect(result).toEqual(SKIP);
    // the skip leaves the plan artifact untouched — no approval bookkeeping
    const art = await db.prisma.artifact.findUnique({ where: { id: "art_skip_1" }, select: { status: true } });
    expect(art?.status).toBe("draft");
  });

  it("approvePlan applies the declared approve transition and releases downstream", async () => {
    const flowId = "flw_ap_2";
    const applied: string[] = [];
    const released: string[] = [];
    const captured: { fn?: () => Promise<void> } = {};
    const service = new FlowApprovalService(makeHost({
      latestResourceArtifact: async () => ({ id: "art_1", content: "# plan", meta: null }) as never,
      transitionTrigger: async (params) => {
        applied.push(`${params.nodeKey}:${params.key}`);
        return { started: true } as TriggerResult;
      },
      bg: (_flowId, nodeKey, fn) => {
        // no template graph in the stub host → the attribution falls back to
        // the approved node itself
        expect(nodeKey).toBe("plan");
        captured.fn = fn;
      },
      advanceFrom: async (_flowId, fromKey) => {
        released.push(fromKey);
      },
    }));
    await service.approvePlan(flowId);
    expect(applied).toEqual(["plan:approve"]);
    // the release block ran inside bg — drive it manually (fire-and-forget)
    if (captured.fn) await captured.fn();
    expect(released).toEqual(["plan"]);
  });

  it("approveNode rejects a built-in approval surface", async () => {
    const flowId = "flw_ap_4";
    await seedNode(flowId, "build", NODE_STATUS.AWAITING_APPROVAL);
    const service = new FlowApprovalService(makeHost({
      defOf: async () => ({ builtinApproval: true, capabilities: {} }) as never,
    }));
    await expect(service.approveNode(flowId, "build")).rejects.toThrow(ValidationError);
  });

  it("approveNode skips a node that is not awaiting approval without releasing downstream", async () => {
    const flowId = "flw_ap_5";
    await seedNode(flowId, "agent", NODE_STATUS.DONE);
    let bgCalls = 0;
    let advanced = 0;
    const service = new FlowApprovalService(makeHost({
      transitionTrigger: async () => SKIP,
      bg: () => { bgCalls += 1; },
      advanceFrom: async () => { advanced += 1; },
    }));
    const result = await service.approveNode(flowId, "agent");
    // the approve transition's from-set is the fence — a non-awaiting node
    // loses it and the service returns the typed skip without a release
    expect(result).toEqual(SKIP);
    expect(bgCalls).toBe(0);
    expect(advanced).toBe(0);
  });

  it("approveNode consults the registered effects on a won approve; a claimed follow-on skips the release", async () => {
    const flowId = "flw_ap_8";
    await seedNode(flowId, "agent", NODE_STATUS.AWAITING_APPROVAL);
    const consulted: Array<{ lifecycle: string; defKey: string; status: string; nodeKey: string }> = [];
    let advanced = 0;
    const service = new FlowApprovalService(makeHost({
      defOf: async () => ({ key: "tmpl_agent_1", builtinApproval: false, capabilities: {} }) as never,
      runEffect: async (lifecycle, ctx) => {
        consulted.push({ lifecycle, defKey: ctx.defKey, status: ctx.status ?? "", nodeKey: ctx.nodeKey });
        return true;
      },
      advanceFrom: async () => { advanced += 1; },
    }));
    await service.approveNode(flowId, "agent");
    // the declarative wildcard's approval door (task 10): the AFTER_APPROVAL
    // lifecycle carries the node's identity and the approved status
    expect(consulted).toEqual([
      { lifecycle: "afterApproval", defKey: "tmpl_agent_1", status: "approved", nodeKey: "agent" },
    ]);
    // the effect claimed the follow-on (a verb ran) — it advances the edges
    // itself; the service must not double-run the release
    expect(advanced).toBe(0);
  });

  it("approveNode releases downstream when no effect claims the won approve (the pre-wildcard behavior)", async () => {
    const flowId = "flw_ap_9";
    await seedNode(flowId, "agent", NODE_STATUS.AWAITING_APPROVAL);
    let effectRuns = 0;
    const captured: { fn?: () => Promise<void> } = {};
    const released: string[] = [];
    const service = new FlowApprovalService(makeHost({
      defOf: async () => ({ builtinApproval: false, capabilities: {} }) as never,
      runEffect: async () => {
        effectRuns += 1;
        return false;
      },
      bg: (_flowId, nodeKey, fn) => {
        expect(nodeKey).toBe("agent");
        captured.fn = fn;
      },
      advanceFrom: async (_flowId, fromKey) => {
        released.push(fromKey);
      },
    }));
    await service.approveNode(flowId, "agent");
    expect(effectRuns).toBe(1);
    if (captured.fn) await captured.fn();
    expect(released).toEqual(["agent"]);
  });

  it("chooseNode rejects a node that is not a decision", async () => {
    const flowId = "flw_ap_6";
    await seedNode(flowId, "agent", NODE_STATUS.AWAITING_APPROVAL);
    const service = new FlowApprovalService(makeHost({
      defOf: async () => ({ builtinApproval: false, capabilities: {} }) as never,
    }));
    await expect(service.chooseNode(flowId, "agent", ["fix"])).rejects.toThrow(/not a decision node/);
  });

  it("chooseNode rejects a node that is not waiting for a branch choice", async () => {
    const flowId = "flw_ap_7";
    await seedNode(flowId, "agent", NODE_STATUS.DONE);
    const service = new FlowApprovalService(makeHost());
    await expect(service.chooseNode(flowId, "agent", ["fix"])).rejects.toThrow(ConflictError);
  });
});
