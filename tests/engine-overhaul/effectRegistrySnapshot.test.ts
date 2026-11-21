/**
 * Registry snapshot (step 07 task 7): for the SDLC builtin chain, the effect
 * registry is the executable answer to "what happens when X finishes?" — the
 * chain's post-finish sequencing is pinned here as registrations, so a drift
 * in the gate→review→resolve→re-gate loop or the CR-before-gate ordering
 * fails this test before it fails a flow.
 *
 * Runs against the isolated dockerized Postgres test database
 * (AGENTS.md §1 — never a demo/real DB).
 */
import { beforeAll, describe, expect, test } from "vitest";
import { assignTestDatabase, resetTestDatabase } from "../helpers/testDatabase";
import { FlowHarness } from "../helpers/flowHarness";

assignTestDatabase();

const { flowEngine } = await import("@/lib/engine/flowEngine");
const { NODE_KEYS } = await import("@/lib/engine/constants/nodeKeys");
const { EFFECT_KEY_ANY } = await import("@/lib/engine/runtime/effects/constants/effectLifecycles");

const harness = new FlowHarness({ db: (await import("@/lib/db/app")).db, flowEngine, templateStore: (await import("@/lib/engine/templates/templateStore")).templateStore });

beforeAll(resetTestDatabase);

describe("SDLC effect registry snapshot (step 07)", () => {
  test("the SDLC chain's post-finish effects are exactly the declared set", () => {
    const entries = flowEngine.effects.entries();
    // the runtime-owned child-terminal doors: fan-out + split each register
    // one onChildTerminal under the runtime wildcard key
    expect(entries.filter((e) => e.defKey === EFFECT_KEY_ANY)).toEqual([
      // the declarative wildcard effects (task 10) — F1-guarded additions:
      // every approval door re-fires its effect, every success door runs the
      // post-success sequencing, both under the runtime wildcard key
      { defKey: EFFECT_KEY_ANY, lifecycle: "afterApproval" },
      { defKey: EFFECT_KEY_ANY, lifecycle: "afterSuccess" },
      // the runtime-owned child-terminal doors: fan-out + split + subflow each
      // register one onChildTerminal under the runtime wildcard key
      { defKey: EFFECT_KEY_ANY, lifecycle: "onChildTerminal" },
      { defKey: EFFECT_KEY_ANY, lifecycle: "onChildTerminal" },
      { defKey: EFFECT_KEY_ANY, lifecycle: "onChildTerminal" },
    ]);
    // the SDLC chain's declared sequencing — the CR-before-gate afterApproval,
    // gate green → review, review done → resolve-if-open, resolve → re-gate
    expect(entries.filter((e) => e.defKey !== EFFECT_KEY_ANY)).toEqual([
      { defKey: NODE_KEYS.BUILD, lifecycle: "afterApproval" },
      { defKey: NODE_KEYS.PIPELINE, lifecycle: "afterSuccess" },
      { defKey: NODE_KEYS.RESOLVE, lifecycle: "loopReentry" },
      { defKey: NODE_KEYS.REVIEW, lifecycle: "afterSuccess" },
    ]);
  });

  test("every registered SDLC defKey is a node in the seeded template", async () => {
    const flowId = await harness.seedSdlcFlow();
    const g = await flowEngine.graph(flowId);
    if (!g) throw new Error("expected the SDLC template graph");
    const templateDefKeys = new Set([...g.byKey.values()].map((s) => s.defKey));
    for (const defKey of [NODE_KEYS.BUILD, NODE_KEYS.PIPELINE, NODE_KEYS.REVIEW, NODE_KEYS.RESOLVE]) {
      expect(templateDefKeys.has(defKey), `seeded template carries ${defKey}`).toBe(true);
    }
  });
});
