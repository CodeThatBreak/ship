import { describe, expect, it } from "vitest";

import { EFFECT_KEY_ANY, EFFECT_LIFECYCLE } from "./constants/effectLifecycles";
import { EffectRegistry } from "./effectRegistry";
import { TRIGGER_SOURCE } from "../triggers/constants/triggerSources";
import type { EffectCtx, NodeEffects } from "./types/nodeEffects";

const ctxOf = (defKey: string): EffectCtx => ({
  flowId: "flow-1",
  nodeKey: "build_1",
  defKey,
  status: "done",
  output: null,
  source: TRIGGER_SOURCE.EFFECT,
});

/** A stable handler identity the double-boot guard can recognize. */
const handler = async () => {};

describe("EffectRegistry (step 07 — Invariant 8)", () => {
  it("dispatches the lifecycle registered for the defKey and reports the claim", async () => {
    const registry = new EffectRegistry();
    const seen: string[] = [];
    registry.register("build", {
      afterSuccess: async (ctx) => {
        seen.push(ctx.nodeKey);
      },
    });

    expect(await registry.run(EFFECT_LIFECYCLE.AFTER_SUCCESS, ctxOf("build"))).toBe(true);
    expect(seen).toEqual(["build_1"]);
    // an unregistered lifecycle on a registered kind is unclaimed
    expect(await registry.run(EFFECT_LIFECYCLE.AFTER_FAILURE, ctxOf("build"))).toBe(false);
  });

  it("runs the runtime-owned wildcard registrations after the exact defKey's", async () => {
    const registry = new EffectRegistry();
    const order: string[] = [];
    registry.register("step_build", {
      onChildTerminal: async () => {
        order.push("exact");
      },
    });
    registry.register(EFFECT_KEY_ANY, {
      onChildTerminal: async () => {
        order.push("wildcard-a");
      },
    });
    registry.register(EFFECT_KEY_ANY, {
      onChildTerminal: async () => {
        order.push("wildcard-b");
      },
    });

    expect(await registry.run(EFFECT_LIFECYCLE.ON_CHILD_TERMINAL, ctxOf("step_build"))).toBe(true);
    expect(order).toEqual(["exact", "wildcard-a", "wildcard-b"]);
    // a kind with no registration at all is unclaimed
    expect(await registry.run(EFFECT_LIFECYCLE.ON_CHILD_TERMINAL, ctxOf("agent"))).toBe(true); // wildcard still owns child terminals
  });

  it("throws on a double-boot of the identical handler for the same pair", () => {
    const registry = new EffectRegistry();
    const effects: NodeEffects = { afterSuccess: handler };
    registry.register("build", effects);
    expect(() => registry.register("build", effects)).toThrow(/duplicate effect registration/);
    // a different handler under the same key is the documented wildcard case —
    // and a distinct second registration on a concrete key is a fresh owner
    expect(() => registry.register("build", { afterSuccess: async () => {} })).not.toThrow();
  });

  it("entries() is the sorted snapshot the registry tests pin", () => {
    const registry = new EffectRegistry();
    registry.register("resolve", { loopReentry: async () => {} });
    registry.register("build", { afterApproval: async () => {} });
    registry.register(EFFECT_KEY_ANY, { onChildTerminal: async () => {} });
    registry.register(EFFECT_KEY_ANY, { onChildTerminal: async () => {} });

    expect(registry.entries()).toEqual([
      { defKey: EFFECT_KEY_ANY, lifecycle: "onChildTerminal" },
      { defKey: EFFECT_KEY_ANY, lifecycle: "onChildTerminal" },
      { defKey: "build", lifecycle: "afterApproval" },
      { defKey: "resolve", lifecycle: "loopReentry" },
    ]);
  });
});
