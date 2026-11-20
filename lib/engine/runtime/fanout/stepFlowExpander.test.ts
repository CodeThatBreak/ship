/**
 * StepFlowExpander (step 07 fan-out decomposition): the fan-out gate and
 * expansion. `resolveMode` is the pure mode-resolution core — explicit
 * `whole`/`steps` override the plan's published execution, `from-plan`
 * defers to it (absent ⇒ `whole`); `gate` short-circuits on the frozen
 * `whole` default before anything else runs.
 */
import { describe, expect, it } from "vitest";
import type { StepFlowEngine } from "./types/stepFlowEngine";
import type { StepFlowExpander } from "./stepFlowExpander";
import type { StepChildStore } from "./stepChildStore";

const { StepFlowExpander: expanderClass } = await import("./stepFlowExpander");
const { StepChildStore: storeClass } = await import("./stepChildStore");
const { StepScheduler: schedulerClass } = await import("./stepScheduler");
const { StepRollup: rollupClass } = await import("./stepRollup");

/** An engine stub that only ever answers the config read — `gate` must
 *  short-circuit on the frozen `whole` knob without touching anything else. */
const wholeKnobEngine = {
  nodeConfigFor: async () => ({ fanout: { mode: "whole" } }),
} as unknown as StepFlowEngine;

/** A wired expander over the stub engine (rollup/scheduler are never reached
 *  by the paths under test — they are wired only to satisfy the constructor). */
const expanderOf = (engine: StepFlowEngine): StepFlowExpander => {
  const children = new storeClass() as StepChildStore;
  // the mutual expander↔scheduler/rollup references resolve lazily
  const wired: { expander?: StepFlowExpander } = {};
  const rollup = new rollupClass(() => engine, children, () => {}, () => wired.expander as StepFlowExpander);
  const scheduler = new schedulerClass(() => engine, children, rollup, () => wired.expander as StepFlowExpander);
  wired.expander = new expanderClass(() => engine, children, scheduler, rollup);
  return wired.expander;
};

describe("StepFlowExpander", () => {
  it("resolveMode: an explicit knob overrides the plan's published execution", () => {
    const expander = expanderOf(wholeKnobEngine);
    expect(expander.resolveMode({ fanout: { mode: "whole" } }, "steps"))
      .toEqual({ mode: "whole", published: "steps", override: true });
    expect(expander.resolveMode({ fanout: { mode: "steps" } }, "whole"))
      .toEqual({ mode: "steps", published: "whole", override: true });
  });

  it("resolveMode: an explicit knob agreeing with the plan is not an override", () => {
    const expander = expanderOf(wholeKnobEngine);
    expect(expander.resolveMode({ fanout: { mode: "steps" } }, "steps"))
      .toEqual({ mode: "steps", published: "steps", override: false });
    expect(expander.resolveMode({ fanout: { mode: "whole" } }, null))
      .toEqual({ mode: "whole", published: null, override: false });
  });

  it("resolveMode: from-plan defers to the plan's published execution (absent ⇒ whole)", () => {
    const expander = expanderOf(wholeKnobEngine);
    expect(expander.resolveMode({ fanout: { mode: "from-plan" } }, "steps"))
      .toEqual({ mode: "steps", published: "steps", override: false });
    expect(expander.resolveMode({ fanout: { mode: "from-plan" } }, "whole"))
      .toEqual({ mode: "whole", published: "whole", override: false });
    expect(expander.resolveMode({ fanout: { mode: "from-plan" } }, null))
      .toEqual({ mode: "whole", published: null, override: false });
  });

  it("gate returns null for the frozen whole knob before any other read", async () => {
    const expander = expanderOf(wholeKnobEngine);
    await expect(expander.gate("flw_whole_knob", "build")).resolves.toBeNull();
  });
});
