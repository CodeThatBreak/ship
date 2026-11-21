import "server-only";

import type { StageGate, StageGateOutcome } from "./types/stageGate";

/**
 * StageGateRegistry — the registered axis for "who owns this node's stage"
 * (task 24, finding E1): the runtimes' expansion gates (plan fan-out, split,
 * and any future runtime) register here at engine boot — the same boot point
 * that wires the effects — and the StageRunner consults the registry instead
 * of chaining runtime imports, so a third runtime registers a gate and never
 * edits engine code (target-architecture §1: the StageRunner carries no
 * fan-out/split special cases).
 *
 * Semantics (today's literal chain, byte-for-byte): gates evaluate in
 * REGISTRATION order; the first gate that does not answer `"run"` wins and
 * later gates are not consulted — `"own"` = the gate ran the stage (the def
 * run is skipped), `{ run, afterRun }` = the def's whole path runs and the
 * gate post-processes its output. Every gate answering `"run"` is the
 * frozen default: the def's normal whole path, no post-process.
 *
 * Invariants:
 * - The gates claim through the same gateway (Invariant 8) — the registry
 *   moves only the dispatch indirection; a gate's claim discipline lives in
 *   its owning runtime.
 * - Registration order IS the evaluation order — the built-in boot order
 *   (fan-out first, then split) is pinned by the registry snapshot test.
 *
 * Must never: write node status, claim a stage itself, or know any specific
 * runtime — the gates are opaque `StageGate` implementations.
 */
export class StageGateRegistry {
  /** the registered gates, registration order = evaluation order */
  private readonly gates: Array<{ name: string; gate: StageGate }> = [];

  /**
   * Boot-time registration. A duplicate name is a double-boot wiring bug —
   * throw (the effectRegistry convention); the name is the snapshot label
   * the registry tests pin, not a lookup key.
   */
  register(name: string, gate: StageGate): void {
    if (this.gates.some((g) => g.name === name)) {
      throw new Error(`duplicate stage gate registration: ${name}`);
    }
    this.gates.push({ name, gate });
  }

  /**
   * Resolve the stage's ownership: the first gate that does not answer
   * `"run"` wins (later gates are not consulted — the whole-wrap claim
   * shadows the split consume exactly like the old chain's short-circuit);
   * every gate answering `"run"` resolves to the default `"run"`.
   */
  async resolve(flowId: string, nodeKey: string): Promise<StageGateOutcome> {
    for (const { gate } of this.gates) {
      const outcome = await gate.gate(flowId, nodeKey);
      if (outcome !== "run") return outcome;
    }
    return "run";
  }

  /** The registered gates in evaluation order — the snapshot the registry
   *  tests pin (the executable answer to "who owns a stage?"). */
  entries(): ReadonlyArray<{ name: string }> {
    return this.gates.map((g) => ({ name: g.name }));
  }
}
