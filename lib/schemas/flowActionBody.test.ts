import { describe, expect, it } from "vitest";
import { FLOW_ACTION } from "@/constants/flow";
import { flowActionBodySchema } from "./flowActionBody";

describe("flowActionBodySchema", () => {
  it("rejects update_plan_steps without steps (CR-042)", () => {
    const result = flowActionBodySchema.safeParse({
      action: FLOW_ACTION.UPDATE_PLAN_STEPS,
    });
    expect(result.success).toBe(false);
  });

  it("accepts update_plan_steps with an explicit steps array", () => {
    const result = flowActionBodySchema.safeParse({
      action: FLOW_ACTION.UPDATE_PLAN_STEPS,
      steps: [{ title: "Ship it" }],
    });
    expect(result.success).toBe(true);
  });

  it("requires config for set_node_config", () => {
    const missing = flowActionBodySchema.safeParse({
      action: FLOW_ACTION.SET_NODE_CONFIG,
      nodeKey: "plan",
    });
    expect(missing.success).toBe(false);

    const ok = flowActionBodySchema.safeParse({
      action: FLOW_ACTION.SET_NODE_CONFIG,
      nodeKey: "plan",
      config: { foo: "bar" },
    });
    expect(ok.success).toBe(true);
  });

  it("requires chosen for choose_node", () => {
    const missing = flowActionBodySchema.safeParse({
      action: FLOW_ACTION.CHOOSE_NODE,
      nodeKey: "decision",
    });
    expect(missing.success).toBe(false);
  });
});
