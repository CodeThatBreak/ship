import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

process.env.DATABASE_PATH = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "devflow-loop-reset-")),
  "test.db",
);

const { db } = await import("../db/app");
const { FlowEngine } = await import("./flowEngine");
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
  db.run(
    `UPDATE nodes SET status=?, output=?, updated_at=? WHERE flow_id=? AND node_key=?`,
    status,
    output ? JSON.stringify(output) : null,
    now(),
    flowId,
    nodeKey,
  );
};

const statusOf = (flowId: string, nodeKey: string): string =>
  db.get<{ status: string }>(
    `SELECT status FROM nodes WHERE flow_id=? AND node_key=?`,
    flowId,
    nodeKey,
  )?.status ?? "";

describe("resetLoopEntry skipped branches (CR-007)", () => {
  const engine = new FlowEngine();

  it("clears a skipped decision branch before the loop's second iteration", async () => {
    const { id: templateId } = importTemplateYaml(templateStore, loopDecisionYaml, {
      namePrefix: "loop-decision",
    });
    const taskId = "task_loop_decision";
    db.run(
      `INSERT INTO tasks (id, type, key, summary, status, issue_type, priority) VALUES (?,?,?,?,?,?,?)`,
      taskId,
      "jira",
      "LOOP-1",
      "loop test",
      "open",
      "task",
      "P2",
    );
    const flowId = engine.create(taskId, "https://example.com/repo.git", "loop test", {
      templateId,
      autoStart: false,
    });

    setNode(flowId, "pass_a", "done");
    setNode(flowId, "pick", "done", { chosen: ["fix"], rationale: "test" });
    setNode(flowId, "fix_path", "done");
    setNode(flowId, "ship_path", "skipped");

    await engine.advanceFrom(flowId, "fix_path");

    expect(statusOf(flowId, "ship_path")).toBe("pending");

    setNode(flowId, "pick", "done", { chosen: ["ship"], rationale: "test" });
    await engine.advanceFrom(flowId, "pick");

    expect(statusOf(flowId, "ship_path")).not.toBe("skipped");
  });
});
