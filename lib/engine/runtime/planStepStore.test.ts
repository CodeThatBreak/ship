/**
 * Plan checklist bulk edit + sync integrity (Task 27 / CR-013, CR-192).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.DATABASE_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "devflow-plan-step-store-")),
  "test.db",
);

const { db } = await import("../../db/app");
const { planSteps } = await import("./planStepStore");
const { formatStepBuildContextPack } = await import("../nodes/kinds/build/schema");
const { parsePlanArtifactMeta } = await import("../nodes/kinds/plan/schema");

const now = () => new Date().toISOString();

const seedFlow = (flowId: string) => {
  const taskId = `task_${flowId}`;
  db.run(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES (?,?,?,?,?,?,?)`,
    taskId,
    "generic",
    flowId.toUpperCase(),
    "plan steps",
    "open",
    "task",
    "P2",
  );
  db.run(
    `INSERT INTO flows (id, task_id, name, status, parent_flow_id, kind, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
    flowId,
    taskId,
    "flow",
    "active",
    null,
    "sdlc",
    now(),
    now(),
  );
  db.run(
    `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
    `node_${flowId}`,
    flowId,
    "plan",
    "plan",
    "awaiting_approval",
    now(),
    now(),
  );
};

const seedArtifact = (flowId: string, id: string) => {
  db.run(
    `INSERT INTO artifacts (id, node_id, flow_id, kind, version, content, meta, status, created_at)
     VALUES (?,?,?,?,?,?,?,'draft',?)`,
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

const insertStep = (args: {
  id: string;
  flowId: string;
  title: string;
  position: number;
  status?: string;
  origin?: string;
  metaId?: string | null;
  artifactId?: string | null;
}) => {
  db.run(
    `INSERT INTO plan_steps (id, flow_id, artifact_id, meta_id, position, title, detail, files, branch, status, origin, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
  it("keeps done agent steps closed with meta_id after a bulk retitle", () => {
    const flowId = "flw_replace_done";
    seedFlow(flowId);
    insertStep({ id: "step_done", flowId, title: "Ship auth", position: 0, status: "done", metaId: "s1" });
    insertStep({ id: "step_open", flowId, title: "Billing", position: 1, metaId: "s2" });

    planSteps.replace(
      flowId,
      null,
      [
        { title: "Ship authentication" },
        { title: "Billing module" },
      ],
      { matchedRows: new Map([[0, "step_done"], [1, "step_open"]]) },
    );

    const rows = planSteps.list(flowId);
    expect(rows).toHaveLength(2);
    const done = rows.find((r) => r.id === "step_done");
    expect(done?.status).toBe("done");
    expect(done?.origin).toBe("agent");
    expect(done?.meta_id).toBe("s1");
    expect(done?.title).toBe("Ship authentication");
  });

  it("does not duplicate agent rows on syncFromPlan after a bulk edit", () => {
    const flowId = "flw_replace_sync";
    seedFlow(flowId);
    seedArtifact(flowId, "art_v1");
    seedArtifact(flowId, "art_v2");
    insertStep({ id: "step_a", flowId, title: "Alpha", position: 0, metaId: "s1", artifactId: "art_v1" });

    planSteps.replace(flowId, "art_v1", [{ title: "Alpha retitled" }], {
      matchedRows: new Map([[0, "step_a"]]),
    });

    planSteps.syncFromPlan(flowId, "art_v2", [
      { id: "s1", title: "Alpha from refine", detail: "", files: [], branch: null },
      { id: "s2", title: "New step", detail: "", files: [], branch: null },
    ]);

    const rows = planSteps.list(flowId);
    expect(rows.filter((r) => r.meta_id === "s1")).toHaveLength(1);
    expect(rows).toHaveLength(2);
  });

  it("keeps started steps at their editor index instead of moving them to the top", () => {
    const flowId = "flw_replace_order";
    const parentId = flowId;
    const childId = "flw_child_started";
    seedFlow(parentId);
    db.run(
      `INSERT INTO flows (id, task_id, name, status, parent_flow_id, kind, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
      childId,
      `task_${parentId}`,
      "child",
      "active",
      parentId,
      "step",
      now(),
      now(),
    );
    db.run(
      `INSERT INTO nodes (id, flow_id, node_key, type, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`,
      "node_child",
      childId,
      "build",
      "build",
      "running",
      now(),
      now(),
    );

    insertStep({ id: "step_pending", flowId, title: "First", position: 0, metaId: "s1" });
    db.run(
      `INSERT INTO plan_steps (id, flow_id, artifact_id, meta_id, position, title, detail, files, branch, status, origin, sub_flow_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      "step_started",
      flowId,
      null,
      "s2",
      1,
      "Started",
      null,
      "[]",
      null,
      "pending",
      "agent",
      childId,
      now(),
      now(),
    );
    insertStep({ id: "step_third", flowId, title: "Third", position: 2, metaId: "s3" });

    planSteps.replace(
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

    expect(planSteps.list(flowId).map((r) => r.id)).toEqual(["step_pending", "step_started", "step_third"]);
  });
});

describe("parsePlanArtifactMeta + step context pack (Task 27)", () => {
  it("applies PlanBranch defaults (dependsOn) when reading artifact meta", () => {
    const meta = parsePlanArtifactMeta({
      steps: [{ title: "One", detail: "", files: [], branch: null }],
      branches: [{ name: "auth", title: "Auth", scope: "login" }],
    });
    expect(meta?.branches[0].dependsOn).toEqual([]);
  });

  it("includes sibling mergeStatus and summary in the context pack", () => {
    const pack = formatStepBuildContextPack([
      {
        id: "s2",
        title: "Billing",
        files: ["b.ts"],
        status: "building",
        mergeStatus: "conflict",
        summary: "needs rebase",
      },
    ]);
    expect(pack).toContain("merge: conflict");
    expect(pack).toContain("summary: needs rebase");
  });
});
