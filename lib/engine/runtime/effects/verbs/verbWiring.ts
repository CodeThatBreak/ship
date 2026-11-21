import "server-only";

import { pinnedProcessService } from "../../../../composition/processServices";
import { engineParts } from "../../../../composition/container";
import { mergeRequests } from "../../../nodes/kinds/mergeRequest/mergeRequestExports";
import { EFFECT_VERB, type EffectVerb } from "../constants/effectVerbs";
import { FACT_KIND } from "../../../facts/types/facts";
import { VerbRegistry } from "../verbRegistry";
import type { VerbDescriptor } from "./types/verbDescriptor";
import { VerbNotWiredError } from "./verbNotWiredError";
import { CreateChangeRequest } from "./createChangeRequest";

/**
 * The verb descriptors registered at engine boot (tasks 10/11). The registry's
 * shape is final — `create_change_request` wraps `MergeRequestService` (task
 * 11); `publish_diff`'s `run` is still the stub seam task 19 replaces.
 */

/** Interim stub run: the verb's implementation has not landed yet — throw
 *  loudly instead of pretending the side effect happened. */
const notWiredYet = (id: EffectVerb) => async (): Promise<boolean> => {
  throw new VerbNotWiredError(id);
};

/** The wired `create_change_request` verb. The collaborators are the shared
 *  module pins (the `mergeRequests`/`engineParts` precedent — DB-fenced, so
 *  per-module-graph copies cannot disagree); the flow context loads through
 *  the engine facade's read model, dereferenced at CALL time — this module
 *  sits inside the engine's boot import graph, so a wiring-time dereference
 *  would read the still-initializing pin. */
const createChangeRequest = new CreateChangeRequest(
  EFFECT_VERB.CREATE_CHANGE_REQUEST,
  mergeRequests,
  async (flowId) => {
    const { flowEngine } = await import("../../../flowEngine");
    return flowEngine.ctx(flowId);
  },
  engineParts.facts,
  engineParts.events,
);

const CREATE_CHANGE_REQUEST: VerbDescriptor = {
  id: EFFECT_VERB.CREATE_CHANGE_REQUEST,
  requiredFacts: [FACT_KIND.BRANCH],
  run: (ctx) => createChangeRequest.run(ctx),
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
