/**
 * Payload-schema tests for `lib/db/rows.ts`: the zod validators are the JSONB
 * boundary every ORM read narrows through (via `lib/db/ormRowHelpers.ts`).
 * Pure schema checks over fixture row objects — the raw gateway they used to
 * ride is gone (orm-migration task 11).
 */
import { describe, expect, it } from "vitest";
import { Task, TaskRow, NodeRow, EventRow } from "./rows";

const now = () => new Date().toISOString();

describe("row payload schemas", () => {
  it("parses a task row and hydrates provider fields on the Task transform", () => {
    const row = {
      id: "task_1",
      type: "generic",
      key: "TST-1",
      summary: "summary",
      description: null,
      status: "open",
      issueType: null,
      priority: null,
      repoUrl: null,
      parentKey: null,
      externalUrl: null,
      raw: null,
      syncedAt: now(),
      fields: { prd: "PRD text", figmaUrls: ["https://figma.com/file/1"] },
    };

    const parsed = TaskRow.parse(row);
    expect(parsed.key).toBe("TST-1");

    const task = Task.parse(row);
    expect(task.prdText).toBe("PRD text");
    expect(task.figmaUrls).toEqual(["https://figma.com/file/1"]);
  });

  it("rejects rows missing required columns", () => {
    // a malformed row is one whose shape violates the schema (missing `type`)
    expect(() => TaskRow.parse({ id: "task_bad", key: "TST-2", summary: "x" })).toThrow();
  });

  it("tolerates non-object events.data in the feed", () => {
    const event = EventRow.parse({
      id: "ev_bad",
      flowId: "flw_ev",
      nodeId: null,
      type: "log",
      message: "x",
      data: ["not", "an", "object"],
      createdAt: now(),
    });
    expect(event.data).toBeNull();
  });

  it("parses node JSONB input and output", () => {
    const node = NodeRow.parse({
      id: "node_n",
      flowId: "flw_n",
      nodeKey: "plan",
      type: "plan",
      status: "pending",
      attemptId: null,
      agentId: null,
      agentRef: null,
      sessionId: null,
      label: null,
      config: null,
      joinMode: null,
      input: { ticket: "x" },
      output: { ok: true },
      createdAt: now(),
      updatedAt: now(),
    });
    expect(node.input).toEqual({ ticket: "x" });
    expect(node.output).toEqual({ ok: true });
  });
});
