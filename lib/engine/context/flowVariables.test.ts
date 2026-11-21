/**
 * Flow context fact exposure: `flow.mr_iid` and the per-branch MR facts
 * (`branches.<name>.{mr_iid, mr_url, status}`) render from the branch rows.
 */
import { testRun } from "@/tests/helpers/rawTestDb";
import { beforeAll, describe, expect, it } from "vitest";

import { assignTestDatabase, resetTestDatabase } from "../../../tests/helpers/testDatabase";

assignTestDatabase();

beforeAll(resetTestDatabase);
const { branchStore } = await import("../nodes/kinds/build/branchStore");
const { buildFlowContext } = await import("./flowVariables");
const { TemplateRenderer } = await import("../nodes/shared/templateRenderer");

const now = () => new Date().toISOString();

const seedFlow = async (flowId: string, taskId: string, mrIid: number | null) => {
  await testRun(
    `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    taskId, "generic", `${taskId.toUpperCase()}-1`, "flow vars", "open", "story", "P2",
  );
  await testRun(
    `INSERT INTO flows (id, task_id, name, status, execution_mode, mr_iid, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    flowId, taskId, "flow vars", "active", "cloud", mrIid, now(), now(),
  );
  return {
    flow: { id: flowId, taskId, mrIid, mrUrl: null, mrBranch: null, triggerPayload: null, repoUrl: null },
    task: { key: `${taskId.toUpperCase()}-1`, summary: "flow vars", issueType: "story" },
  } as never;
};

describe("buildFlowContext — MR facts", () => {
  it("renders {{flow.mr_iid}} and {{branches.<name>.*}} from the flow and branch rows", async () => {
    const ctx = await seedFlow("flw_vars_1", "task_vars_1", 7);
    await branchStore.upsert("flw_vars_1", "backend", {
      title: "Backend",
      status: "done",
      mrIid: 42,
      mrUrl: "https://git.example.com/acme/widgets/-/merge_requests/42",
    });

    const vars = await buildFlowContext(ctx);
    const rendered = TemplateRenderer.render(
      "flow MR !{{flow.mr_iid}}; backend {{branches.backend.mr_url}} (!{{branches.backend.mr_iid}}, {{branches.backend.status}})",
      vars,
    );

    expect(rendered).toBe(
      "flow MR !7; backend https://git.example.com/acme/widgets/-/merge_requests/42 (!42, done)",
    );
  });

  it("renders empty values when the flow and its branches carry no MR yet", async () => {
    const ctx = await seedFlow("flw_vars_2", "task_vars_2", null);
    await branchStore.upsert("flw_vars_2", "frontend", { title: "Frontend" });

    const vars = await buildFlowContext(ctx);

    expect(vars.branches).toEqual({ frontend: { mr_iid: null, mr_url: "", status: "pending" } });
    expect(TemplateRenderer.render("[{{flow.mr_iid}}][{{branches.frontend.mr_url}}]", vars)).toBe("[][]");
  });
});
