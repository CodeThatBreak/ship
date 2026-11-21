import { describe, expect, it } from "vitest";

import { EFFECT_VERB, type EffectVerb } from "../runtime/effects/constants/effectVerbs";
import { EFFECT_KEY_ANY, EFFECT_LIFECYCLE } from "../runtime/effects/constants/effectLifecycles";
import { EffectRegistry } from "../runtime/effects/effectRegistry";
import { VerbRegistry } from "../runtime/effects/verbRegistry";
import type { VerbDescriptor } from "../runtime/effects/verbs/types/verbDescriptor";
import { TRIGGER_SOURCE } from "../runtime/triggers/constants/triggerSources";
import { FACT_KIND } from "../facts/types/facts";
import {
  declaredEffectVerbs,
  registerDeclarativeEffects,
  type DeclarativeEffectsHost,
} from "./declarativeEffects";
import type { EffectCtx } from "../runtime/effects/types/nodeEffects";

const ctxOf = (overrides: Partial<EffectCtx> = {}): EffectCtx => ({
  flowId: "flow-1",
  nodeKey: "changelog_1",
  defKey: "tmpl_agent_1",
  status: "awaiting_approval",
  output: null,
  source: TRIGGER_SOURCE.UI,
  ...overrides,
});

/** A verb descriptor that records its dispatches instead of doing work —
 *  the stand-in for the task-11/19 implementations. */
const recordingVerb = (id: EffectVerb, claims = true): { descriptor: VerbDescriptor; calls: EffectCtx[] } => {
  const calls: EffectCtx[] = [];
  return {
    descriptor: {
      id,
      requiredFacts: [FACT_KIND.BRANCH],
      run: async (ctx) => {
        calls.push(ctx);
        return claims;
      },
    },
    calls,
  };
};

interface HostCalls {
  configs: string[];
  advanced: string[];
}

const hostOf = (
  config: Record<string, unknown> = {},
  calls: HostCalls = { configs: [], advanced: [] },
): DeclarativeEffectsHost => ({
  nodeConfigFor: async (_flowId, nodeKey) => {
    calls.configs.push(nodeKey);
    return config;
  },
  advanceFrom: async (_flowId, nodeKey) => {
    calls.advanced.push(nodeKey);
  },
});

/** The wiring under test: a fresh EffectRegistry + VerbRegistry with a
 *  recording verb registered, and the declarative wildcards registered
 *  against a stubbed catalog-kind linkage read. */
const wired = (host: DeclarativeEffectsHost, verb: { descriptor: VerbDescriptor }, catalogKind: string | null) => {
  const effects = new EffectRegistry();
  const verbs = new VerbRegistry();
  verbs.register(verb.descriptor);
  registerDeclarativeEffects(effects, verbs, host, async () => catalogKind);
  return { effects, verbs };
};

describe("declarativeEffects (task 10 — findings B3/F1/F3)", () => {
  it("dispatches the config-declared afterApproval verb on the approval door's consult and claims the follow-on", async () => {
    const create = recordingVerb(EFFECT_VERB.CREATE_CHANGE_REQUEST);
    const calls: HostCalls = { configs: [], advanced: [] };
    const { effects } = wired(hostOf({ effects: { afterApproval: ["create_change_request"] } }, calls), create, "agent");

    expect(await effects.run(EFFECT_LIFECYCLE.AFTER_APPROVAL, ctxOf())).toBe(true);
    expect(create.calls).toHaveLength(1);
    expect(create.calls[0]?.nodeKey).toBe("changelog_1");
    // the effect owns the follow-on (Invariant 8): it advanced the edges
    // itself instead of leaving them to the caller's default walk
    expect(calls.advanced).toEqual(["changelog_1"]);
  });

  it("dispatches the config-declared afterSuccess verb on the post-terminal consult", async () => {
    const publish = recordingVerb(EFFECT_VERB.PUBLISH_DIFF);
    const calls: HostCalls = { configs: [], advanced: [] };
    const { effects } = wired(hostOf({ effects: { afterSuccess: ["publish_diff"] } }, calls), publish, "script");

    expect(await effects.run(
      EFFECT_LIFECYCLE.AFTER_SUCCESS,
      ctxOf({ status: "done" }),
    )).toBe(true);
    expect(publish.calls).toHaveLength(1);
    expect(calls.advanced).toEqual(["changelog_1"]);
  });

  it("a declarative node with no effects config no-ops and leaves the caller's default intact (F3, byte-for-byte)", async () => {
    const create = recordingVerb(EFFECT_VERB.CREATE_CHANGE_REQUEST);
    const calls: HostCalls = { configs: [], advanced: [] };
    const { effects } = wired(hostOf({}, calls), create, "agent");

    expect(await effects.run(EFFECT_LIFECYCLE.AFTER_SUCCESS, ctxOf())).toBe(false);
    expect(await effects.run(EFFECT_LIFECYCLE.AFTER_APPROVAL, ctxOf())).toBe(false);
    expect(create.calls).toHaveLength(0);
    expect(calls.advanced).toEqual([]); // the default edge walk stays the caller's
  });

  it("a built-in node never runs the declarative effects — even with an (impossible) effects config (F3)", async () => {
    const create = recordingVerb(EFFECT_VERB.CREATE_CHANGE_REQUEST);
    const publish = recordingVerb(EFFECT_VERB.PUBLISH_DIFF);
    const calls: HostCalls = { configs: [], advanced: [] };
    // the built-in's snapshot config CANNOT carry the key; even if it did,
    // the linkage read (node_templates kind) keeps the wildcard out
    const effects = new EffectRegistry();
    const verbs = new VerbRegistry();
    verbs.register(create.descriptor);
    verbs.register(publish.descriptor);
    registerDeclarativeEffects(
      effects,
      verbs,
      hostOf(
        { effects: { afterApproval: ["create_change_request"], afterSuccess: ["publish_diff"] } },
        calls,
      ),
      async () => "build",
    );

    expect(await effects.run(EFFECT_LIFECYCLE.AFTER_APPROVAL, ctxOf({ defKey: "build" }))).toBe(false);
    expect(await effects.run(EFFECT_LIFECYCLE.AFTER_SUCCESS, ctxOf({ defKey: "build" }))).toBe(false);
    expect(create.calls).toHaveLength(0);
    expect(publish.calls).toHaveLength(0);
    expect(calls.configs).toEqual([]); // the config is never even read for a built-in
    expect(calls.advanced).toEqual([]);
  });

  it("declaredEffectVerbs fails loudly on a malformed map or an unknown verb id", () => {
    expect(declaredEffectVerbs({}, EFFECT_LIFECYCLE.AFTER_APPROVAL)).toEqual([]);
    expect(declaredEffectVerbs({ effects: null }, EFFECT_LIFECYCLE.AFTER_SUCCESS)).toEqual([]);
    expect(
      declaredEffectVerbs({ effects: { afterApproval: ["create_change_request"] } }, EFFECT_LIFECYCLE.AFTER_APPROVAL),
    ).toEqual([EFFECT_VERB.CREATE_CHANGE_REQUEST]);
    expect(() => declaredEffectVerbs({ effects: "yes" }, EFFECT_LIFECYCLE.AFTER_APPROVAL)).toThrow(/must be an object/);
    expect(() =>
      declaredEffectVerbs({ effects: { afterApproval: ["not_a_verb"] } }, EFFECT_LIFECYCLE.AFTER_APPROVAL),
    ).toThrow(/not a declarable effect verb/);
  });

  it("registers only under the runtime wildcard key (Invariant F1 — no literal declarative def key)", () => {
    const { effects } = wired(hostOf(), recordingVerb(EFFECT_VERB.CREATE_CHANGE_REQUEST), "agent");
    expect(effects.entries().map((e) => e.defKey)).toEqual([EFFECT_KEY_ANY, EFFECT_KEY_ANY]);
    expect(effects.entries().map((e) => e.lifecycle)).toEqual(["afterApproval", "afterSuccess"]);
  });
});
