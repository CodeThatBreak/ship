/**
 * Completion batch transaction (engine overhaul step 06, task 3 — Invariant 7):
 * every multi-row completion write is ONE Prisma transaction, and a crash
 * mid-transaction leaves NO partial state — no artifact without its terminal,
 * no check-off without the aggregate, no event for a write that never landed.
 *
 * Fault injection: `db.transaction` is stubbed to run its callback against a
 * proxy tx client whose raw executor throws on the first statement matching a
 * SQL pattern (a simulated crash mid-transaction). Assertions then read the
 * database and expect the pre-batch state everywhere — nothing half-applied.
 *
 * Runs against the isolated dockerized Postgres test database
 * (AGENTS.md §1 — never a demo/real DB).
 */
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import type { Prisma } from "@prisma/client";
import type { StepRollup } from "@/lib/engine/runtime/fanout/stepRollup";
import { assignTestDatabase, resetTestDatabase } from "../helpers/testDatabase";
import { FlowHarness } from "../helpers/flowHarness";
import { expectTransitionsDeclared } from "../helpers/transitionLogAssert";

assignTestDatabase();

const { db } = await import("@/lib/db/app");
const { flowEngine } = await import("@/lib/engine/flowEngine");
const { templateStore } = await import("@/lib/engine/templates/templateStore");
const { nodeRegistry } = await import("@/lib/engine/nodes/registry");
const { stepFlows } = await import("@/lib/engine/runtime/fanout/stepFlowManager");
const { planSteps } = await import("@/lib/engine/runtime/planStepStore");

const harness = new FlowHarness({ db, flowEngine, templateStore });

beforeAll(resetTestDatabase);

type TransactionFn = typeof db.transaction;
const realTransaction: TransactionFn = db.transaction.bind(db);

// ── the fault-injection hook ─────────────────────────────────────────────────

/**
 * Wrap `db.transaction`: inside the transaction every raw statement is
 * intercepted, and the FIRST one whose SQL matches `failOn` throws — a
 * simulated crash mid-transaction. The callback runs against a proxy tx
 * client, so the throwing statement never executes and everything before it
 * rolls back with the transaction.
 */
const injectTransactionFault = (failOn: RegExp): void => {
  /** Prisma models whose calls ride the fault seam (completion-batch writers). */
  const FAULTED_MODELS: readonly string[] = ["planStep", "artifact"];
  (db as { transaction: TransactionFn }).transaction = (async (fn, tx) => {
    if (tx) return realTransaction(fn, tx); // joined transactions keep the caller's (proxied) tx
    return db.prisma.$transaction(async (inner) => {
      let calls = 0;
      const faultOrRun = (label: string, run: () => unknown): unknown => {
        calls += 1;
        if (failOn.test(label)) throw new Error(`simulated crash mid-transaction (call #${calls}: ${label})`);
        return run();
      };
      const proxy = new Proxy(inner, {
        get(target, prop, receiver) {
          if (prop === "$executeRawUnsafe" || prop === "$queryRawUnsafe") {
            return (sql: string, ...args: unknown[]) =>
              faultOrRun(sql, () =>
                ((target as Record<string, unknown>)[prop as string] as (...a: unknown[]) => unknown).apply(target, [sql, ...args]));
          }
          // model-API writes (e.g. planStep.updateMany, artifact.create) fault
          // on `<model>.<method>` — the ORM conversion moved the completion
          // batch's writes from raw SQL onto these model delegates, so the
          // fault seam follows them.
          if (FAULTED_MODELS.includes(prop as string)) {
            const model = Reflect.get(target, prop, receiver) as unknown as Record<string | symbol, (...a: unknown[]) => unknown>;
            return new Proxy(model, {
              get(modelTarget, method) {
                return (...args: unknown[]) =>
                  faultOrRun(`${String(prop)}.${String(method)}`, () =>
                    (modelTarget[method] as (...a: unknown[]) => unknown).apply(modelTarget, args));
              },
            });
          }
          return Reflect.get(target, prop, receiver);
        },
      }) as Prisma.TransactionClient;
      return fn(proxy);
    });
  }) as TransactionFn;
};

afterEach(() => {
  (db as { transaction: TransactionFn }).transaction = realTransaction;
});

// ── read handles (SQL reads only — never a write path) ───────────────────────

const nodeRowOf = async (flowId: string, nodeKey: string): Promise<Record<string, unknown>> => {
  const row = await db.get<Record<string, unknown>>(`SELECT * FROM nodes WHERE flow_id=$1 AND node_key=$2`, flowId, nodeKey);
  if (!row) throw new Error(`no node row for ${flowId}/${nodeKey}`);
  return row;
};

const artifactsOf = async (flowId: string): Promise<{ id: string; kind: string; version: number; status: string }[]> =>
  db.all(`SELECT id, kind, version, status FROM artifacts WHERE flow_id=$1 ORDER BY version`, flowId);

const eventsOf = async (flowId: string): Promise<{ type: string; message: string }[]> =>
  db.all(`SELECT type, message FROM events WHERE flow_id=$1 ORDER BY created_at, id`, flowId);

const defOfNode = async (flowId: string, nodeKey: string) => {
  const spec = (await harness.graphForFlow(flowId))?.byKey.get(nodeKey);
  if (!spec) throw new Error(`no graph node ${nodeKey} on ${flowId}`);
  return nodeRegistry.resolve(spec.defKey, nodeKey);
};

/** `applyOutcome` is the defs' protected completion door — the test drives it
 *  through the engine-resolved def instance exactly like the run tail does. */
type ApplyOutcomeFn = (ctx: unknown, outcome: unknown, opts?: unknown) => Promise<unknown>;
const applyOutcomeOf = async (flowId: string, nodeKey: string): Promise<ApplyOutcomeFn> => {
  const def = await defOfNode(flowId, nodeKey);
  return (def as unknown as { applyOutcome: ApplyOutcomeFn }).applyOutcome.bind(def);
};

const seedTriageFlow = (): Promise<string> => harness.seedInlineFlow(
  [{
    key: "triage",
    def: "nt_st_triage",
    config: { mode: "plan", output: "json", prompt: "triage" },
  }],
  [],
);

// the seeded triage def's output contract: severity (low/med/high) + summary
const TRIX_OUTCOME = {
  status: "done",
  output: { severity: "high", summary: "likely cause identified" },
  artifact: { kind: "triage", content: "triage notes", meta: { source: "completion-transaction-test" } },
  event: "triage finished",
  reply: "done",
};

describe("completion batch transaction (step 06, Invariant 7)", () => {
  test("a crash on the terminal write rolls the whole applyOutcome batch back — no partial state", async () => {
    const flowId = await seedTriageFlow();
    await harness.claimNode(flowId, "triage", "runFromPending");
    const ctx = await flowEngine.ctx(flowId);
    const apply = await applyOutcomeOf(flowId, "triage");
    const eventsBefore = await eventsOf(flowId);

    // the terminal statement (the publishOutcome UPDATE carrying `output=$2::jsonb`)
    // crashes mid-transaction — the artifact writes before it must roll back too
    injectTransactionFault(/output=\$2::jsonb/);
    await expect(apply(ctx, TRIX_OUTCOME)).rejects.toThrow(/simulated crash/);

    expect(await artifactsOf(flowId)).toEqual([]); // no artifact without its terminal
    expect(await harness.nodeStatus(flowId, "triage")).toBe("running"); // the claim survived untouched
    expect((await nodeRowOf(flowId, "triage")).output ?? null).toBeNull();
    expect(await eventsOf(flowId)).toEqual(eventsBefore); // no lifecycle event for a write that never landed
  });

  test("a crash on the artifact insert also leaves nothing (the batch is one unit)", async () => {
    const flowId = await seedTriageFlow();
    await harness.claimNode(flowId, "triage", "runFromPending");
    const ctx = await flowEngine.ctx(flowId);
    const apply = await applyOutcomeOf(flowId, "triage");

    injectTransactionFault(/artifact\.create/);
    await expect(apply(ctx, TRIX_OUTCOME)).rejects.toThrow(/simulated crash/);

    expect(await artifactsOf(flowId)).toEqual([]);
    expect(await harness.nodeStatus(flowId, "triage")).toBe("running");
  });

  test("the happy path lands every row of the batch (artifact + terminal + lifecycle event)", async () => {
    const flowId = await seedTriageFlow();
    await harness.claimNode(flowId, "triage", "runFromPending");
    const ctx = await flowEngine.ctx(flowId);
    const apply = await applyOutcomeOf(flowId, "triage");

    const result = await apply(ctx, TRIX_OUTCOME);
    expect(result).toMatchObject({ output: { severity: "high", summary: "likely cause identified" } });

    expect(await harness.nodeStatus(flowId, "triage")).toBe("done");
    expect(await harness.nodeOutput(flowId, "triage")).toMatchObject({ severity: "high" });
    const artifacts = await artifactsOf(flowId);
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({ kind: "triage", version: 1, status: "draft" });
    const lifecycle = (await eventsOf(flowId)).filter((e) => e.type === "lifecycle");
    expect(lifecycle.some((e) => e.message.includes("triage finished"))).toBe(true);

    // every transition this path drove resolves against the declared table
    expectTransitionsDeclared(flowEngine.transitions, flowId);
  });

  test("a crash inside the output-contract-violation batch leaves the node running with no failure trail", async () => {
    const flowId = await seedTriageFlow();
    await harness.claimNode(flowId, "triage", "runFromPending");
    const ctx = await flowEngine.ctx(flowId);
    const apply = await applyOutcomeOf(flowId, "triage");
    const eventsBefore = await eventsOf(flowId);

    injectTransactionFault(/output=\$2::jsonb/);
    await expect(apply(ctx, { ...TRIX_OUTCOME, output: { severity: 123, summary: "x" } })).rejects.toThrow(/simulated crash/);

    // validation happens OUTSIDE the tx — no artifact was saved for the
    // violating outcome; the violation batch (event + failed terminal +
    // lifecycle) rolled back whole
    expect(await artifactsOf(flowId)).toEqual([]);
    expect(await harness.nodeStatus(flowId, "triage")).toBe("running");
    expect(await eventsOf(flowId)).toEqual(eventsBefore);
  });

  test("a crash inside the fan-out rollup batch leaves the check-off unapplied (no partial rollup)", async () => {
    // parent: one fan-out consumer node (declarative — no mergeBack, so the
    // rollup batch is the check-offs + the aggregate terminal's run-up)
    const flowId = await harness.seedInlineFlow(
      [{ key: "build", def: "nt_st_triage", config: { mode: "plan", output: "json", prompt: "triage" } }],
      [],
    );
    await harness.claimNode(flowId, "build", "runFromPending"); // the rollup publishes from `running`

    // a resolved step child linked to a pending plan step
    const childTpl = await templateStore.create(
      {
        name: "ovh-ctx-rollup-child",
        trigger: { type: "manual" },
        nodes: [{ key: "work", nodeTemplateId: "nt_st_triage", trigger: { type: "auto" } }],
        edges: [],
      },
      { skipLint: true },
    );
    const childFlowId = await flowEngine.createStepChild(flowId, childTpl, "step child", {
      plan: { title: "OVH-1: overhaul harness task", summary: "overhaul harness task" },
      step: { id: "s1", title: "Step one", detail: null, files: [] },
      siblings: [],
      parentNodeKey: "build",
      workNodeKey: "work",
    }, { branch: null });
    await harness.setNodeOutputForFixture(childFlowId, "work", "done", { summary: "child work" });
    // fixture setup ONLY: link the pending plan step to its child flow (the
    // planSteps store has no sub_flow_id setter — the expansion writes it raw)
    await db.run(
      `INSERT INTO plan_steps (id, flow_id, position, title, detail, files, status, origin, sub_flow_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,'pending','agent',$7,$8,$9)`,
      "step_ctx_1", flowId, 0, "Step one", null, "[]", childFlowId, db.now(), db.now(),
    );

    // the rollup moved into the fan-out runtime's StepRollup (step 07) —
    // reached through the bound facade's rollup member
    const rollup = (stepFlows as unknown as { rollup: StepRollup }).rollup;
    // the check-off rides the Prisma model API through the tx — crashing ON
    // it must roll the WHOLE batch back (no partial rollup)
    injectTransactionFault(/planStep\.updateMany/);
    await expect(rollup.checkRollup(flowId, "build")).rejects.toThrow(/simulated crash/);

    // nothing partial: the step is still pending, the parent still running,
    // no aggregate output was published
    const step = (await planSteps.list(flowId)).find((s) => s.id === "step_ctx_1");
    expect(step?.status).toBe("pending");
    expect(step?.completedBy ?? null).toBeNull();
    expect(await harness.nodeStatus(flowId, "build")).toBe("running");
    expect(await harness.nodeOutput(flowId, "build")).toBeNull();

    // the rollup re-runs (idempotent hooks) and lands the whole batch
    (db as { transaction: TransactionFn }).transaction = realTransaction;
    await rollup.checkRollup(flowId, "build");
    const done = (await planSteps.list(flowId)).find((s) => s.id === "step_ctx_1");
    expect(done?.status).toBe("done");
    expect(done?.completedBy).toBe("child");
    expect(await harness.nodeStatus(flowId, "build")).toBe("done");
    const aggregate = await harness.nodeOutput(flowId, "build");
    expect((aggregate?.steps as { id: string; status: string }[])[0]).toMatchObject({ id: "step_ctx_1", status: "done" });
    expectTransitionsDeclared(flowEngine.transitions, flowId);
  });
});
