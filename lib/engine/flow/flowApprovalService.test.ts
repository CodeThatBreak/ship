import { beforeAll, describe, expect, it } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../../../tests/helpers/testDatabase";

assignTestDatabase();

const { db } = await import("../../db/app");
const { FlowApprovalService } = await import("./flowApprovalService");
const { ConflictError, ValidationError } = await import("../../errors");
const { NODE_STATUS } = await import("../constants/nodeStatus");

/**
 * FlowApprovalService — the approval paths' own contract (step-02 carve-out):
 * the execution-override chip, the declared `approve` transition, the
 * shared release-downstream block, and the guard rejections. The end-to-end
 * approve flows are covered by the engine tests (sdlcHappyPath,
 * stepFlowManager's approveChildStep, flowEngine's guard tests).
 */
type ApprovalHost = import("./types/approvalHost").ApprovalHost;

const seedNode = async (flowId: string, nodeKey: string, status: string): Promise<void> => {
  await db.run(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    `task_${flowId}`, "generic", flowId.toUpperCase(), "approval test", "open", "task", "P2",
  );
  await db.run(
    `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES ($1,$2,$3,$4,now(),now())`,
    flowId, `task_${flowId}`, "t", "active",
  );
  await db.run(
    `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES ($1,$2,$3,'agent',$4,now(),now())`,
    db.uid("node_"), flowId, nodeKey, status,
  );
};

const makeHost = (over: Partial<ApprovalHost> = {}): ApprovalHost => ({
  keyOfRole: async () => "plan",
  nodeStatus: async () => NODE_STATUS.AWAITING_APPROVAL,
  defOf: async () => ({ builtinApproval: false, capabilities: {} }) as never,
  graph: async () => null,
  ctx: async () => { throw new Error("not used"); },
  isStepChild: async () => false,
  latestResourceArtifact: async () => undefined,
  setNodeStatus: async () => true,
  sdlcApproveBuild: async () => {},
  emitLifecycle: async () => {},
  bg: () => {},
  advanceFrom: async () => {},
  ...over,
});

describe("FlowApprovalService", () => {
  beforeAll(async () => {
    await resetTestDatabase();
  });

  it("approvePlan rejects a plan that is not awaiting approval", async () => {
    const service = new FlowApprovalService(makeHost({ nodeStatus: async () => NODE_STATUS.PENDING }));
    await expect(service.approvePlan("flw_ap_1")).rejects.toThrow(ConflictError);
  });

  it("approvePlan applies the declared approve transition and releases downstream", async () => {
    const flowId = "flw_ap_2";
    const applied: string[] = [];
    const released: string[] = [];
    const captured: { fn?: () => Promise<void> } = {};
    const service = new FlowApprovalService(makeHost({
      latestResourceArtifact: async () => ({ id: "art_1", content: "# plan", meta: null }) as never,
      setNodeStatus: async (_flowId, nodeKey, key) => {
        applied.push(`${nodeKey}:${key}`);
        return true;
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

  it("approvePlan records the execution override in the plan meta when it differs", async () => {
    const flowId = "flw_ap_3";
    const events: string[] = [];
    await seedNode(flowId, "plan", NODE_STATUS.AWAITING_APPROVAL);
    await db.run(
      `INSERT INTO artifacts (id, node_id, flow_id, kind, version, content, meta, status, created_at)
       VALUES ($1,(SELECT id FROM nodes WHERE flow_id=$2 AND node_key='plan'),$2,'plan',1,'# plan',$3::jsonb,'draft',now())`,
      "art_ov_1", flowId, JSON.stringify({ execution: "whole", executionSource: "planner" }),
    );
    const service = new FlowApprovalService(makeHost({
      nodeStatus: async () => NODE_STATUS.AWAITING_APPROVAL,
      latestResourceArtifact: async () =>
        (await db.get<{ id: string; content: string; meta: unknown }>(
          `SELECT id, content, meta FROM artifacts WHERE id=$1`, "art_ov_1")) as never,
      emitLifecycle: async (_flowId, _nodeKey, message) => {
        events.push(message);
      },
    }));
    await service.approvePlan(flowId, "steps");
    const meta = await db.get<{ meta: unknown }>(`SELECT meta FROM artifacts WHERE id=$1`, "art_ov_1");
    const parsed = typeof meta?.meta === "string" ? JSON.parse(meta.meta) : meta?.meta;
    expect(parsed).toMatchObject({ execution: "steps", executionSource: "override" });
    expect(parsed.execution_rationale).toBeUndefined();
    expect(events.some((m) => m.includes("plan execution overridden at approve"))).toBe(true);
  });

  it("approveNode rejects a built-in approval surface", async () => {
    const flowId = "flw_ap_4";
    await seedNode(flowId, "build", NODE_STATUS.AWAITING_APPROVAL);
    const service = new FlowApprovalService(makeHost({
      defOf: async () => ({ builtinApproval: true, capabilities: {} }) as never,
    }));
    await expect(service.approveNode(flowId, "build")).rejects.toThrow(ValidationError);
  });

  it("approveNode rejects a node that is not awaiting approval", async () => {
    const flowId = "flw_ap_5";
    await seedNode(flowId, "agent", NODE_STATUS.DONE);
    const service = new FlowApprovalService(makeHost({ nodeStatus: async () => NODE_STATUS.DONE }));
    await expect(service.approveNode(flowId, "agent")).rejects.toThrow(ConflictError);
  });

  it("chooseNode rejects a node that is not a decision", async () => {
    const flowId = "flw_ap_6";
    await seedNode(flowId, "agent", NODE_STATUS.AWAITING_APPROVAL);
    const service = new FlowApprovalService(makeHost({
      defOf: async () => ({ builtinApproval: false, capabilities: {} }) as never,
    }));
    await expect(service.chooseNode(flowId, "agent", ["fix"])).rejects.toThrow(/not a decision node/);
  });
});
