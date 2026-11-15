import { describe, expect, it, vi } from "vitest";
import { assignTestDatabase } from "../../tests/helpers/testDatabase";

assignTestDatabase();

const { FlowEngine } = await import("./flowEngine");

describe("FlowEngine.handleHostEvent", () => {
  const engine = new FlowEngine();

  it("swallows pipeline gate errors so webhooks can ack (CR-044)", async () => {
    const flow = { id: "flw_gateless" } as import("../db/rows").FlowRow;
    vi.spyOn(engine, "findFlowByMR").mockResolvedValue(flow);
    vi.spyOn(engine, "triggerPipelineGate").mockImplementation(async () => {
      throw new Error("this flow template has no pipeline gate node");
    });

    await expect(engine.handleHostEvent({
      kind: "pipeline",
      projectId: 1,
      projectUrl: "https://gitlab.example/group/project",
      crNumber: 42,
      pipeline: { id: 9, status: "failed" },
    })).resolves.toBeUndefined();
  });
});
