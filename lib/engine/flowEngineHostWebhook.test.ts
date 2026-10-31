import { describe, expect, it, vi } from "vitest";
import { assignDatabasePath, createIsolatedDatabasePath } from "../../tests/helpers/inMemoryDb";

assignDatabasePath(createIsolatedDatabasePath("devflow-host-webhook-"));

const { FlowEngine } = await import("./flowEngine");

describe("FlowEngine.handleHostEvent", () => {
  const engine = new FlowEngine();

  it("swallows pipeline gate errors so webhooks can ack (CR-044)", () => {
    const flow = { id: "flw_gateless" } as import("../db/rows").FlowRow;
    vi.spyOn(engine, "findFlowByMR").mockReturnValue(flow);
    vi.spyOn(engine, "triggerPipelineGate").mockImplementation(() => {
      throw new Error("this flow template has no pipeline gate node");
    });

    expect(() => engine.handleHostEvent({
      kind: "pipeline",
      projectId: 1,
      projectUrl: "https://gitlab.example/group/project",
      crNumber: 42,
      pipeline: { id: 9, status: "failed" },
    })).not.toThrow();
  });
});
