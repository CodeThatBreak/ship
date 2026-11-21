import { describe, expect, it } from "vitest";
import { flowSummary, flowSummaries } from "@/types/flows";

/** The shape `flowEngine.list()` returns (Prisma rows, camelCase + task join). */
const listRow = {
  id: "flw_1",
  taskId: "tsk_1",
  name: "Run",
  status: "running",
  mrUrl: "https://gitlab.example.com/a/b/-/merge_requests/1",
  executionMode: "local",
  task: { key: "DEV-1", summary: "Do the thing" },
  fanout: { steps: 3, done: 1, active: true },
};

describe("flowSummary", () => {
  it("reads the camelCase list row and the nested task relation", () => {
    expect(flowSummary(listRow)).toEqual({
      id: "flw_1",
      taskId: "tsk_1",
      name: "Run",
      status: "running",
      taskKey: "DEV-1",
      taskSummary: "Do the thing",
      mrUrl: "https://gitlab.example.com/a/b/-/merge_requests/1",
      executionMode: "local",
      fanout: { steps: 3, done: 1, active: true },
    });
  });

  it("tolerates a missing task relation", () => {
    const row = flowSummary({ id: "flw_2", task: null });
    expect(row.taskKey).toBe("");
    expect(row.taskSummary).toBe("");
  });

  it("drops rows without an id", () => {
    expect(flowSummaries([listRow, { name: "no id" }]).map((f) => f.id)).toEqual(["flw_1"]);
  });
});
