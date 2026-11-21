import { describe, expect, it } from "vitest";

import type { VerbDescriptor } from "./verbs/types/verbDescriptor";
import type { EffectCtx } from "./types/nodeEffects";
import { assignTestDatabase } from "../../../../tests/helpers/testDatabase";

// Task 11: `create_change_request` is wired over MergeRequestService (whose
// module graph reaches the DB client), so the descriptors register through
// the dynamic-import pattern every DB-touching test file uses — env assigned
// before any `db` import resolves.
assignTestDatabase();

const { EFFECT_VERB } = await import("./constants/effectVerbs");
const { VerbRegistry } = await import("./verbRegistry");
const { registerVerbDescriptors } = await import("./verbs/verbWiring");
const { VerbNotWiredError } = await import("./verbs/verbNotWiredError");
const { FACT_KIND } = await import("../../facts/types/facts");
const { TRIGGER_SOURCE } = await import("../triggers/constants/triggerSources");

const ctxOf = (): EffectCtx => ({
  flowId: "flow-1",
  nodeKey: "build_1",
  defKey: "tmpl_agent_1",
  status: "approved",
  output: null,
  source: TRIGGER_SOURCE.EFFECT,
});

describe("VerbRegistry (task 10 — design §4.2)", () => {
  it("registers the closed verb union exactly once each, with their required facts", async () => {
    const registry = new VerbRegistry();
    registerVerbDescriptors(registry);

    expect(registry.descriptors().map((d) => d.id)).toEqual([
      EFFECT_VERB.CREATE_CHANGE_REQUEST,
      EFFECT_VERB.PUBLISH_DIFF,
      EFFECT_VERB.RETRIGGER_PIPELINE,
    ]);
    const byId = new Map(registry.descriptors().map((d) => [d.id, d]));
    expect(byId.get(EFFECT_VERB.CREATE_CHANGE_REQUEST)?.requiredFacts).toEqual([FACT_KIND.BRANCH]);
    expect(byId.get(EFFECT_VERB.PUBLISH_DIFF)?.requiredFacts).toEqual([FACT_KIND.DIFF]);
    expect(byId.get(EFFECT_VERB.RETRIGGER_PIPELINE)?.requiredFacts).toEqual([FACT_KIND.CHANGE_REQUEST]);
  });

  it("throws on a duplicate verb registration (the double-boot guard)", () => {
    const registry = new VerbRegistry();
    const descriptor: VerbDescriptor = {
      id: EFFECT_VERB.PUBLISH_DIFF,
      requiredFacts: [],
      run: async () => true,
    };
    registry.register(descriptor);
    expect(() => registry.register(descriptor)).toThrow(/duplicate verb registration/);
  });

  it("run dispatches to the registered descriptor and reports its claim", async () => {
    const registry = new VerbRegistry();
    const seen: string[] = [];
    registry.register({
      id: EFFECT_VERB.PUBLISH_DIFF,
      requiredFacts: [FACT_KIND.DIFF],
      run: async (ctx) => {
        seen.push(ctx.nodeKey);
        return true;
      },
    });

    expect(await registry.run(EFFECT_VERB.PUBLISH_DIFF, ctxOf())).toBe(true);
    expect(seen).toEqual(["build_1"]);
  });

  it("run throws loudly on an unregistered verb id", async () => {
    const registry = new VerbRegistry();
    await expect(registry.run(EFFECT_VERB.CREATE_CHANGE_REQUEST, ctxOf())).rejects.toThrow(/unknown effect verb/);
  });

  it("the still-unwired stub verb throws the typed not-wired error, not a silent no-op (task 19 wires publish_diff)", async () => {
    const registry = new VerbRegistry();
    registerVerbDescriptors(registry);
    await expect(registry.run(EFFECT_VERB.PUBLISH_DIFF, ctxOf())).rejects.toThrow(VerbNotWiredError);
  });
});
