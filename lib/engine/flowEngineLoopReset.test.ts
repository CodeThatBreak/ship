import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.DATABASE_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "devflow-loop-reset-")),
  "test.db",
);

const { db } = await import("../db/app");
const { FlowEngine } = await import("./flowEngine/flowEngine");
const { importTemplateYaml } = await import("./templates/templateYaml");
const { templateStore } = await import("./templates/templateStore");

const loopDecisionYaml = `
name: Loop decision reset
trigger:
  type: manual
nodes:
  - key: pass_a
    type: script
    config:
      runtime: shell
      script: "true"
  - key: pick
    type: decision
    config:
      source: expression
      choices:
        - label: fix
          condition: "true"
        - label: ship
          condition: "true"
  - key: fix_path
    type: script
    config:
      runtime: shell
      script: "true"
  - key: ship_path
    type: script
    config:
      runtime: shell
      script: "true"
edges:
  - [pass_a, pick]
  - [pick, fix_path, {label: fix}]
  - [pick, ship_path, {label: ship}]
  - [fix_path, pass_a, {kind: loop, condition: "true"}]
`;

const now = () => new Date().toISOString();

const setNode = (
  flowId: string,
  nodeKey: string,
  status: string,
  output: Record<string, unknown> | null = null,
) => {
  return db.run(
    `UPDATE nodes SET status=$1, output=$2, updated_at=$3 WHERE flow_id=$4 AND node_key=$5`,
    status,
    output ? JSON.stringify(output) : null,
    now(),
    flowId,
    nodeKey,
  );
};

const statusOf = async (flowId: string, nodeKey: string): Promise<string> =>
  (
    await db.get<{ status: string }>(
      `SELECT status FROM nodes WHERE flow_id=$1 AND node_key=$2`,
      flowId,
      nodeKey,
    )
  )?.status ?? "";

describe("resetLoopEntry skipped branches (CR-007)", () => {
  const engine = new FlowEngine();

  it("clears a skipped decision branch before the loop's second iteration", async () => {
    const { id: templateId } = await importTemplateYaml(templateStore, loopDecisionYaml, {
      namePrefix: "loop-decision",
    });
    const taskId = "task_loop_decision";
    await db.run(
      `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      taskId,
      "jira",
      "LOOP-1",
      "loop test",
      "open",
      "task",
      "P2",
    );
    const flowId = await engine.create(taskId, "https://example.com/repo.git", "loop test", {
      templateId,
      autoStart: false,
    });

    await setNode(flowId, "pass_a", "done");
    await setNode(flowId, "pick", "done", { chosen: ["fix"], rationale: "test" });
    await setNode(flowId, "fix_path", "done");
    await setNode(flowId, "ship_path", "skipped");

    await engine.advanceFrom(flowId, "fix_path");

    expect(await statusOf(flowId, "ship_path")).toBe("pending");

    await setNode(flowId, "pick", "done", { chosen: ["ship"], rationale: "test" });
    await engine.advanceFrom(flowId, "pick");

    expect(await statusOf(flowId, "ship_path")).not.toBe("skipped");
  });
});
