/**
 * StepFlowManager facade (step 07 fan-out decomposition): the checklist skip
 * guard and the hidden auto-wrap hook conventions, plus the delegation seam —
 * the facade forwards the gate/expansion surface to the `StepFlowExpander`
 * (the class-level coverage lives in each collaborator's co-located test).
 */
import { beforeAll, describe, expect, it } from "vitest";
import type { StepFlowEngine } from "./types/stepFlowEngine";
import type { StepFlowManager } from "./stepFlowManager";

const { db } = await import("../../../db/app");
const { resetTestDatabase } = await import("../../../../tests/helpers/testDatabase");
const { flowEngine } = await import("../../flowEngine");
const { stepFlows, StepFlowManager: managerClass } = await import("./stepFlowManager");
const { hookStore } = await import("../hookStore");

const now = () => new Date().toISOString();

beforeAll(resetTestDatabase);

describe("StepFlowManager (Task 19)", () => {
  it("skipStepFlow rejects when the plan step is no longer pending (CR-010)", async () => {
    const taskId = "task_skip_async";
    const flowId = "flw_skip_async";
    await db.run(
      `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      taskId, "generic", "SK-1", "skip async", "open", "task", "P2",
    );
    await db.run(
      `INSERT INTO flows (id, task_id, name, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6)`,
      flowId, taskId, "parent", "active", now(), now(),
    );
    await db.run(
      `INSERT INTO plan_steps (id, flow_id, title, status, position, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      "ps_skip", flowId, "Step", "done", 0, now(), now(),
    );

    await expect(flowEngine.skipFanoutStep(flowId, "ps_skip")).rejects.toThrow(/already done/);
  });

  it("does not provision inbound hooks for hidden auto-wrap templates (CR-064)", async () => {
    const tplId = db.uid("tpl_");
    const ts = db.now();
    await db.run(
      `INSERT INTO flow_templates (id,name,description,version,is_builtin,trigger,hidden,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9)`,
      tplId, "Hidden child", "fanout-autowrap:tpl_src:build:deadbeef", 1, false,
      JSON.stringify({ type: "manual" }), true, ts, ts,
    );
    await hookStore.syncTemplate(tplId);
    expect(await hookStore.hookForTemplate(tplId)).toBeUndefined();
  });

  it("the facade delegates the fan-out gate to the expander (a fresh manager, unbound → loud)", async () => {
    // unbound: the bound-engine seam fails loud — the facade holds no logic of its own
    const unbound = new managerClass() as unknown as {
      gate(flowId: string, nodeKey: string): Promise<"fanout" | "whole-wrap" | null>;
    };
    await expect(unbound.gate("flw_unbound", "build")).rejects.toThrow(/not bound to the engine/);

    // bound to a stub whose knob is the frozen whole default: the gate
    // short-circuits in the expander and the facade returns its verdict
    const stubEngine = {
      nodeConfigFor: async () => ({ fanout: { mode: "whole" } }),
    } as unknown as StepFlowEngine;
    const manager = new managerClass() as StepFlowManager;
    manager.bind(stubEngine);
    await expect(manager.gate("flw_whole_knob", "build")).resolves.toBeNull();
  });
});

describe("stepFlows singleton", () => {
  it("exposes the facade bound by flowEngine's module tail", () => {
    expect(stepFlows).toBeInstanceOf(managerClass);
  });
});
