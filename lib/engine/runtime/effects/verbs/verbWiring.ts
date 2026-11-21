import "server-only";

import { pinnedProcessService } from "../../../../composition/processServices";
import { EFFECT_VERB, type EffectVerb } from "../constants/effectVerbs";
import { FACT_KIND } from "../../../facts/types/facts";
import { VerbRegistry } from "../verbRegistry";
import type { VerbDescriptor } from "./types/verbDescriptor";
import { VerbNotWiredError } from "./verbNotWiredError";

/**
 * The verb descriptors registered at engine boot (task 10). The registry's
 * shape is final — the two verbs' `run` implementations are the stub seams
 * tasks 11 (`create_change_request` over `MergeRequestService`) and 19
 * (`publish_diff` over the review posting) replace; nothing else changes.
 */

/** Interim stub run: the verb's implementation has not landed yet — throw
 *  loudly instead of pretending the side effect happened. */
const notWiredYet = (id: EffectVerb) => async (): Promise<boolean> => {
  throw new VerbNotWiredError(id);
};

const CREATE_CHANGE_REQUEST: VerbDescriptor = {
  id: EFFECT_VERB.CREATE_CHANGE_REQUEST,
  requiredFacts: [FACT_KIND.BRANCH],
  run: notWiredYet(EFFECT_VERB.CREATE_CHANGE_REQUEST),
};

const PUBLISH_DIFF: VerbDescriptor = {
  id: EFFECT_VERB.PUBLISH_DIFF,
  requiredFacts: [FACT_KIND.DIFF],
  run: notWiredYet(EFFECT_VERB.PUBLISH_DIFF),
};

/** Boot-time registration (used by the shared pin below and by tests that
 *  wire their own descriptor sets). */
export const registerVerbDescriptors = (registry: VerbRegistry): void => {
  registry.register(CREATE_CHANGE_REQUEST);
  registry.register(PUBLISH_DIFF);
};

/** Shared verb registry (the `declarativeKindRegistry` precedent, decision
 *  Q9): the descriptors are static code — every module-graph copy registers
 *  the same entries, so copies cannot disagree. The VerbRegistry class lives
 *  in `../verbRegistry.ts` — class files are pure (classFilePurity arch
 *  test); this module keeps the pin. */
export const verbRegistry = pinnedProcessService("verbRegistry", () => {
  const registry = new VerbRegistry();
  registerVerbDescriptors(registry);
  return registry;
});
