/**
 * StageGateRegistry (task 24 — finding E1): the registered axis for "who owns
 * this node's stage". The iteration semantics pin today's literal chain
 * byte-for-byte — the first gate that does not answer "run" wins and later
 * gates are never consulted ("own" = the gate ran the stage; { run, afterRun }
 * = the def runs then the gate post-processes; every gate answering "run" is
 * the frozen default whole path) — and the built-in snapshot pins the two
 * registered gates in the frozen boot order: fan-out first, then split.
 */
import { describe, expect, it } from "vitest";
import type { StageGate, StageGateOutcome } from "./types/stageGate";
import type { StepFlowManager } from "../fanout/stepFlowManager/stepFlowManager";
import type { SplitManager } from "../split/splitManager/splitManager";

const { StageGateRegistry } = await import("./stageGateRegistry");
const { registerFanoutStageGate, FANOUT_STAGE_GATE } = await import("../fanout/fanoutStageGate");
const { registerSplitStageGate, SPLIT_STAGE_GATE } = await import("../split/splitStageGate");

/** A stable gate that records its consultations and answers a canned verdict. */
const spyGate = (verdict: StageGateOutcome, consulted: string[], label: string): StageGate => ({
  gate: async () => {
    consulted.push(label);
    return verdict;
  },
});

/** A stub StepFlowManager speaking the expander's verdicts, recording the
 *  collaborator calls the gate adapter must make in order. */
const fanoutStub = (
  verdict: "fanout" | "whole-wrap" | null,
): { manager: StepFlowManager; calls: string[] } => {
  const calls: string[] = [];
  const manager = {
    gate: async () => {
      calls.push("gate");
      return verdict;
    },
    expand: async () => {
      calls.push("expand");
      return true;
    },
    wrapWholeOutput: async () => {
      calls.push("wrapWholeOutput");
    },
  } as unknown as StepFlowManager;
  return { manager, calls };
};

/** A stub SplitManager speaking the expander's boolean verdict. */
const splitStub = (engages: boolean): SplitManager =>
  ({ stageGate: async () => engages }) as unknown as SplitManager;

describe("StageGateRegistry (task 24 — the registered axis)", () => {
  it("the first 'own' gate wins; later gates are never consulted", async () => {
    const registry = new StageGateRegistry();
    const consulted: string[] = [];
    registry.register("first", spyGate("own", consulted, "first"));
    registry.register("second", spyGate("own", consulted, "second"));

    expect(await registry.resolve("flw_1", "build")).toBe("own");
    expect(consulted).toEqual(["first"]);
  });

  it("a { run, afterRun } claim stops the iteration — the def run is the runner's, the afterRun is the gate's", async () => {
    const registry = new StageGateRegistry();
    const consulted: string[] = [];
    let wrapped = false;
    registry.register("first", {
      gate: async () => {
        consulted.push("first");
        return { run: true, afterRun: async () => { wrapped = true; } };
      },
    });
    registry.register("second", spyGate("own", consulted, "second"));

    const outcome = await registry.resolve("flw_1", "build");
    expect(outcome).toEqual({ run: true, afterRun: expect.any(Function) });
    expect(consulted).toEqual(["first"]); // the split gate is not consulted behind a whole-wrap claim
    if (outcome === "run" || outcome === "own") throw new Error("unreachable");
    await outcome.afterRun();
    expect(wrapped).toBe(true);
  });

  it("every gate answering 'run' resolves to the default — the frozen whole path, no afterRun", async () => {
    const registry = new StageGateRegistry();
    const consulted: string[] = [];
    registry.register("first", spyGate("run", consulted, "first"));
    registry.register("second", spyGate("run", consulted, "second"));

    expect(await registry.resolve("flw_1", "build")).toBe("run");
    expect(consulted).toEqual(["first", "second"]); // both were consulted, in order
  });

  it("an empty registry is the frozen default", async () => {
    const registry = new StageGateRegistry();
    expect(await registry.resolve("flw_1", "build")).toBe("run");
  });

  it("throws on a duplicate registration name (a double-boot wiring bug)", () => {
    const registry = new StageGateRegistry();
    const consulted: string[] = [];
    registry.register("fanout", spyGate("run", consulted, "x"));
    expect(() => registry.register("fanout", spyGate("run", consulted, "y"))).toThrow(/duplicate stage gate registration/);
  });

  it("entries() preserves the registration order — the evaluation order", () => {
    const registry = new StageGateRegistry();
    const consulted: string[] = [];
    registry.register("split", spyGate("run", consulted, "x"));
    registry.register("fanout", spyGate("run", consulted, "y"));

    expect(registry.entries()).toEqual([{ name: "split" }, { name: "fanout" }]);
  });
});

describe("the built-in gate adapters (the old chain, verbatim)", () => {
  it("the fan-out adapter: 'fanout' expands and owns the node ('own')", async () => {
    const registry = new StageGateRegistry();
    const { manager, calls } = fanoutStub("fanout");
    registerFanoutStageGate(registry, manager);

    expect(await registry.resolve("flw_1", "build")).toBe("own");
    expect(calls).toEqual(["gate", "expand"]); // the expansion ran inside the gate, like the old chain
  });

  it("the fan-out adapter: 'whole-wrap' runs the def then wraps ({ run, afterRun })", async () => {
    const registry = new StageGateRegistry();
    const { manager, calls } = fanoutStub("whole-wrap");
    registerFanoutStageGate(registry, manager);

    const outcome = await registry.resolve("flw_1", "build");
    expect(outcome).toEqual({ run: true, afterRun: expect.any(Function) });
    expect(calls).toEqual(["gate"]); // the def's run has not happened yet
    if (outcome === "run" || outcome === "own") throw new Error("unreachable");
    await outcome.afterRun();
    expect(calls).toEqual(["gate", "wrapWholeOutput"]);
  });

  it("the fan-out adapter: the frozen whole default (null) is 'run'", async () => {
    const registry = new StageGateRegistry();
    const { manager, calls } = fanoutStub(null);
    registerFanoutStageGate(registry, manager);

    expect(await registry.resolve("flw_1", "build")).toBe("run");
    expect(calls).toEqual(["gate"]);
  });

  it("the split adapter: engaged is 'own', the whole path is 'run'", async () => {
    const engaged = new StageGateRegistry();
    registerSplitStageGate(engaged, splitStub(true));
    expect(await engaged.resolve("flw_1", "consumer")).toBe("own");

    const whole = new StageGateRegistry();
    registerSplitStageGate(whole, splitStub(false));
    expect(await whole.resolve("flw_1", "consumer")).toBe("run");
  });

  it("the built-in order holds end to end: fan-out claims ahead of split", async () => {
    const registry = new StageGateRegistry();
    const { manager: wholeWrapManager } = fanoutStub("whole-wrap");
    registerFanoutStageGate(registry, wholeWrapManager);
    registerSplitStageGate(registry, splitStub(true)); // would own, but is shadowed

    expect(await registry.resolve("flw_1", "build")).toEqual({ run: true, afterRun: expect.any(Function) });
  });
});

describe("StageGateRegistry built-in snapshot (the E1 guard)", () => {
  it("registers exactly the two built-in gates, fan-out first then split", () => {
    const registry = new StageGateRegistry();
    registerFanoutStageGate(registry, {} as StepFlowManager);
    registerSplitStageGate(registry, {} as SplitManager);

    // The executable answer to "who owns a stage?" — the registration order
    // IS the evaluation order, so this pin is the frozen chain order. Every
    // later gate task extends this snapshot with its own registration.
    expect(registry.entries()).toEqual([{ name: FANOUT_STAGE_GATE }, { name: SPLIT_STAGE_GATE }]);
    expect(FANOUT_STAGE_GATE).toBe("fanout");
    expect(SPLIT_STAGE_GATE).toBe("split");
  });
});
