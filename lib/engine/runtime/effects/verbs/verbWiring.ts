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
import { RetriggerPipeline } from "./retriggerPipeline";
import { PublishReviewComments } from "./publishReviewComments";
import { gitHostRegistry } from "../../../ports/gitHost";

/**
 * The verb descriptors registered at engine boot (tasks 10/11/17/19). The registry's
 * shape is final — `create_change_request` wraps `MergeRequestService` (task
 * 11), `retrigger_pipeline` wraps the git host port's `retryPipeline` (task
 * 17), `publish_review_comments` wraps the built-in review node's posting
 * path (task 19); `publish_diff`'s `run` is still the unwired stub seam a
 * later task replaces.
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

/** The wired `retrigger_pipeline` verb (task 17): presses retry on the gate's
 *  recorded pipeline over the git host port. The collaborators follow the
 *  `create_change_request` precedent — the shared module pin for the host
 *  registry and a CALL-time dereference of the engine facade's read model. */
const retriggerPipeline = new RetriggerPipeline(
  EFFECT_VERB.RETRIGGER_PIPELINE,
  gitHostRegistry,
  async (flowId) => {
    const { flowEngine } = await import("../../../flowEngine");
    return flowEngine.ctx(flowId);
  },
  engineParts.facts,
  engineParts.events,
);

const RETRIGGER_PIPELINE: VerbDescriptor = {
  id: EFFECT_VERB.RETRIGGER_PIPELINE,
  requiredFacts: [FACT_KIND.CHANGE_REQUEST],
  run: (ctx) => retriggerPipeline.run(ctx),
};

/** The wired `publish_review_comments` verb (task 19): posts the review
 *  run's parsed comments to the established change request over the git host
 *  port, the `postedHashes` ledger riding the review artifact's meta. The
 *  collaborators follow the `retrigger_pipeline` precedent — the shared
 *  module pin for the host registry and node support, a CALL-time
 *  dereference of the engine facade's read model. */
const publishReviewComments = new PublishReviewComments(
  EFFECT_VERB.PUBLISH_REVIEW_COMMENTS,
  gitHostRegistry,
  async (flowId) => {
    const { flowEngine } = await import("../../../flowEngine");
    return flowEngine.ctx(flowId);
  },
  engineParts.facts,
  engineParts.events,
  engineParts.nodeSupport,
);

const PUBLISH_REVIEW_COMMENTS: VerbDescriptor = {
  id: EFFECT_VERB.PUBLISH_REVIEW_COMMENTS,
  requiredFacts: [FACT_KIND.CHANGE_REQUEST],
  run: (ctx) => publishReviewComments.run(ctx),
};

/** Boot-time registration (used by the shared pin below and by tests that
 *  wire their own descriptor sets). */
export const registerVerbDescriptors = (registry: VerbRegistry): void => {
  registry.register(CREATE_CHANGE_REQUEST);
  registry.register(PUBLISH_DIFF);
  registry.register(RETRIGGER_PIPELINE);
  registry.register(PUBLISH_REVIEW_COMMENTS);
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
