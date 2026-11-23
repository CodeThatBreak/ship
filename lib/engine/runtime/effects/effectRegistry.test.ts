import { describe, expect, it } from "vitest";

import { EFFECT_KEY_ANY, EFFECT_LIFECYCLE } from "./constants/effectLifecycles";
import { EffectRegistry } from "./effectRegistry";
import { TRIGGER_SOURCE } from "../triggers/constants/triggerSources";
import { registerSdlcEffects } from "../../nodes/chains/sdlcEffects";
import type { ChainHost } from "../../nodes/chains/types/chainHost";
import type { SdlcChain } from "../../nodes/chains/sdlcChain";
import { NODE_KEYS } from "../../constants/nodeKeys";
import type { EffectCtx, NodeEffects } from "./types/nodeEffects";
import { VerbRegistry } from "./verbRegistry";
import { registerVerbDescriptors } from "./verbs/verbWiring";
import { registerDeclarativeEffects, type DeclarativeEffectsHost } from "../../nodes/declarativeEffects";

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

/** The snapshot only reads registrations — the handlers never fire, so the
 *  collaborators are inert stubs. */
const inert = <T>(): T => ({}) as T;

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

  it("a wildcard handler claims the follow-on only by returning true", async () => {
    const registry = new EffectRegistry();
    registry.register(EFFECT_KEY_ANY, {
      afterSuccess: async () => true,
    });
    // the wildcard decided relevance inside itself (config/linkage) and ran
    expect(await registry.run(EFFECT_LIFECYCLE.AFTER_SUCCESS, ctxOf("agent"))).toBe(true);

    const silent = new EffectRegistry();
    silent.register(EFFECT_KEY_ANY, {
      afterSuccess: async () => {},
    });
    // a wildcard that found nothing to do leaves the caller's default (the
    // edge walk) intact — Invariant F3's config-absent no-op
    expect(await silent.run(EFFECT_LIFECYCLE.AFTER_SUCCESS, ctxOf("agent"))).toBe(false);
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
    registry.register(EFFECT_KEY_ANY, { afterSuccess: async () => {} });
    registry.register(EFFECT_KEY_ANY, { afterSuccess: async () => {} });

    expect(registry.entries()).toEqual([
      { defKey: EFFECT_KEY_ANY, lifecycle: "afterSuccess" },
      { defKey: EFFECT_KEY_ANY, lifecycle: "afterSuccess" },
      { defKey: "build", lifecycle: "afterApproval" },
      { defKey: "resolve", lifecycle: "loopReentry" },
    ]);
  });
});

describe("EffectRegistry built-in snapshot (the F1 guard)", () => {
  it("registers exactly the built-ins' def keys plus the runtime-owned wildcards — never a literal declarative def key", () => {
    const registry = new EffectRegistry();
    registerSdlcEffects(registry, inert<ChainHost>(), inert<SdlcChain>());
    // task 10: the declarative wildcard effects — relevance comes from the
    // node's config, so the registration is wildcard-only (Invariant F1: no
    // literal declarative def key ever enters this registry)
    const verbs = new VerbRegistry();
    registerVerbDescriptors(verbs);
    registerDeclarativeEffects(registry, verbs, inert<DeclarativeEffectsHost>());

    // The executable answer to "what happens when X finishes?" — every later
    // effects task extends this snapshot with its own registration.
    expect(registry.entries()).toEqual([
      { defKey: EFFECT_KEY_ANY, lifecycle: "afterApproval" },
      { defKey: EFFECT_KEY_ANY, lifecycle: "afterSuccess" },
      { defKey: NODE_KEYS.BUILD, lifecycle: "afterApproval" },
      { defKey: NODE_KEYS.PIPELINE, lifecycle: "afterSuccess" },
      { defKey: NODE_KEYS.RESOLVE, lifecycle: "loopReentry" },
      { defKey: NODE_KEYS.REVIEW, lifecycle: "afterSuccess" },
    ]);
    // the F1 guard itself: every registered def key is the runtime wildcard
    // or a built-in NODE_KEY — a declarative template id would be a literal
    // def-key dispatch (the thing findings B3/F1 forbid)
    for (const { defKey } of registry.entries()) {
      expect(defKey === EFFECT_KEY_ANY || Object.values(NODE_KEYS).includes(defKey as never)).toBe(true);
    }
  });
});
