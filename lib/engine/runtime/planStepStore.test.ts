/**
 * Plan checklist bulk edit + sync integrity (Task 27 / CR-013, CR-192).
 */
import { testRun } from "@/tests/helpers/rawTestDb";
import { describe, expect, it } from "vitest";

const { planSteps } = await import("./planStepStore");
const { parsePlanArtifactMeta } = await import("../nodes/kinds/plan/schema");

const now = () => new Date().toISOString();

const seedFlow = async (flowId: string) => {
  const taskId = `task_${flowId}`;
  await testRun(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    taskId,
    "generic",
    flowId.toUpperCase(),
    "plan steps",
    "open",
    "task",
    "P2",
  );
  await testRun(
    `INSERT INTO flows (id, task_id, name, status, kind, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    flowId,
    taskId,
    "flow",
    "active",
    "sdlc",
    now(),
    now(),
  );
  await testRun(
    `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    `node_${flowId}`,
    flowId,
    "plan",
    "plan",
    "awaiting_approval",
    now(),
    now(),
  );
};

const seedArtifact = async (flowId: string, id: string) => {
  await testRun(
    `INSERT INTO artifacts (id, node_id, flow_id, kind, version, content, meta, status, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8)`,
    id,
    `node_${flowId}`,
    flowId,
    "plan",
    1,
    "# plan",
    null,
    now(),
  );
};

const insertStep = async (args: {
  id: string;
  flowId: string;
  title: string;
  position: number;
  status?: string;
  origin?: string;
  metaId?: string | null;
  artifactId?: string | null;
}) => {
  await testRun(
    `INSERT INTO plan_steps (id, flow_id, artifact_id, meta_id, position, title, detail, files, branch, status, origin, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13)`,
    args.id,
    args.flowId,
    args.artifactId ?? null,
    args.metaId ?? null,
    args.position,
    args.title,
    null,
    "[]",
    null,
    args.status ?? "pending",
    args.origin ?? "agent",
    now(),
    now(),
  );
};

describe("PlanStepStore.replace (Task 27)", () => {
  it("keeps done agent steps closed with meta_id after a bulk retitle", async () => {
    const flowId = "flw_replace_done";
    await seedFlow(flowId);
    await insertStep({ id: "step_done", flowId, title: "Ship auth", position: 0, status: "done", metaId: "s1" });
    await insertStep({ id: "step_open", flowId, title: "Billing", position: 1, metaId: "s2" });

    await planSteps.replace(
      flowId,
      null,
      [
        { title: "Ship authentication" },
        { title: "Billing module" },
      ],
      { matchedRows: new Map([[0, "step_done"], [1, "step_open"]]) },
    );

    const rows = await planSteps.list(flowId);
    expect(rows).toHaveLength(2);
    const done = rows.find((r) => r.id === "step_done");
    expect(done?.status).toBe("done");
    expect(done?.origin).toBe("agent");
    expect(done?.metaId).toBe("s1");
    expect(done?.title).toBe("Ship authentication");
  });

  it("does not duplicate agent rows on syncFromPlan after a bulk edit", async () => {
    const flowId = "flw_replace_sync";
    await seedFlow(flowId);
    await seedArtifact(flowId, "art_v1");
    await seedArtifact(flowId, "art_v2");
    await insertStep({ id: "step_a", flowId, title: "Alpha", position: 0, metaId: "s1", artifactId: "art_v1" });

    await planSteps.replace(flowId, "art_v1", [{ title: "Alpha retitled" }], {
      matchedRows: new Map([[0, "step_a"]]),
    });

    await planSteps.syncFromPlan(flowId, "art_v2", [
      { id: "s1", title: "Alpha from refine", detail: "", files: [], branch: null },
      { id: "s2", title: "New step", detail: "", files: [], branch: null },
    ]);

    const rows = await planSteps.list(flowId);
    expect(rows.filter((r) => r.metaId === "s1")).toHaveLength(1);
    expect(rows).toHaveLength(2);
  });

  it("keeps matched steps at their editor index instead of moving them to the top", async () => {
    const flowId = "flw_replace_order";
    await seedFlow(flowId);

    await insertStep({ id: "step_pending", flowId, title: "First", position: 0, metaId: "s1" });
    await insertStep({ id: "step_started", flowId, title: "Started", position: 1, metaId: "s2" });
    await insertStep({ id: "step_third", flowId, title: "Third", position: 2, metaId: "s3" });

    await planSteps.replace(
      flowId,
      null,
      [
        { title: "First" },
        { title: "Started (edited title)" },
        { title: "Third moved" },
      ],
      {
        matchedRows: new Map([
          [0, "step_pending"],
          [1, "step_started"],
          [2, "step_third"],
        ]),
      },
    );

    expect((await planSteps.list(flowId)).map((r) => r.id)).toEqual(["step_pending", "step_started", "step_third"]);
  });
});

describe("parsePlanArtifactMeta (Task 27)", () => {
  it("applies PlanStep defaults when reading artifact meta", () => {
    const meta = parsePlanArtifactMeta({
      steps: [{ title: "One" }],
    });
    expect(meta?.steps[0]).toMatchObject({ title: "One", detail: "", files: [], branch: null });
  });
});
