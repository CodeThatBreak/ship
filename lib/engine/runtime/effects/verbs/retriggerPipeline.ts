import "server-only";

import type { FlowCtx } from "../../../nodes/shared/nodeSharedExports";
import type { GitHostResolver } from "../../../ports/gitHost";
import type { FactStore } from "../../../facts/factStore";
import type { TransitionEvents } from "../../transitions/transitionEvents";
import { EVENT_KIND } from "../../../constants/vocabulary";
import { FACT_KIND } from "../../../facts/types/facts";
import type { EffectVerb } from "../constants/effectVerbs";
import type { VerbCtx } from "./types/verbDescriptor";
import { EffectContractViolation } from "./effectContractViolation";

/**
 * The `retrigger_pipeline` verb (task 17, design §4.2 use case 6): presses
 * retry on the failed pipeline the gate recorded, wrapping the host port's
 * `retryPipeline` — the 80%-built surface the gate never called. Fired from
 * the panel ("Retrigger pipeline", beside the re-check), an afterSuccess-class
 * action rather than an automatic lifecycle effect.
 *
 * Invariants upheld:
 * - The verb runs under the node's claim — the panel verb door dispatched it
 *   after the `panelVerb` trigger won the gateway's transition fence; nothing
 *   here touches `nodes.status` (the re-check action re-runs the gate; the
 *   retrigger only re-drives the host's pipeline).
 * - Required fact `change_request`: a flow without an established change
 *   request fails loudly — a typed `effect_contract_violation` event naming
 *   the verb and the missing fact, then the typed error — never a silent
 *   no-op and never a host call against an unestablished pipeline.
 * - The run is a single host call with no DB writes: there is no journal job
 *   to enqueue (Invariant 7 has nothing to fence) and no fact can land
 *   half-established.
 *
 * Must never: write node status, create a NEW pipeline (`createPipeline` is
 * the re-check path's own seam, not this verb's), or swallow a host failure —
 * the throw surfaces to the route and the panel's action error state.
 */
export class RetriggerPipeline {
  constructor(
    /** the closed verb id this instance runs (the descriptor's `id`) */
    private readonly verbId: EffectVerb,
    /** the repo-scoped git host resolution (the node-registered seam) */
    private readonly gitHosts: GitHostResolver,
    /** the flow context loader (the engine's read model — call-time resolved) */
    private readonly ctxOf: (flowId: string) => Promise<FlowCtx>,
    /** the fact vocabulary read model (the established change request) */
    private readonly facts: Pick<FactStore, "changeRequestFact">,
    /** the typed event emission primitive (the feed's contract-violation kind) */
    private readonly events: Pick<TransitionEvents, "emit">,
  ) {}

  /** Run the verb. Returns `true` — the host accepted the retry, and the verb
   *  always does its one thing when it passes its contract (the wildcard
   *  effect's claim to the follow-on, Invariant 8). */
  async run(ctx: VerbCtx): Promise<boolean> {
    const pipelineId = recordedPipelineId(ctx.output);
    if (pipelineId === null) {
      throw await this.refuse(ctx, "the node's output records no pipeline id to retrigger");
    }
    const cr = await this.facts.changeRequestFact(ctx.flowId);
    if (!cr) throw await this.refuse(ctx, "no run has established a change request yet");
    const flowCtx = await this.ctxOf(ctx.flowId);
    const repoUrl = flowCtx.flow.repoUrl;
    if (!repoUrl) {
      throw new Error(`flow ${ctx.flowId} has no repo url — no git host to retrigger the pipeline on`);
    }
    const host = await this.gitHosts.forRepo(repoUrl);
    await host.retryPipeline(repoUrl, pipelineId);
    return true;
  }

  /** The loud refusal: the typed `effect_contract_violation` feed event
   *  naming the verb and the missing fact, attached to the dispatching node —
   *  the returned error is the caller's throw (the route answers 500; the
   *  pipeline was never touched). */
  private async refuse(ctx: VerbCtx, detail: string): Promise<EffectContractViolation> {
    const violation = new EffectContractViolation(this.verbId, FACT_KIND.CHANGE_REQUEST, detail);
    await this.events.emit(
      ctx.flowId,
      ctx.nodeKey,
      EVENT_KIND.EFFECT_CONTRACT_VIOLATION,
      `${ctx.nodeKey}: ${violation.message}`,
      { nodeKey: ctx.nodeKey, verb: this.verbId, fact: FACT_KIND.CHANGE_REQUEST },
    );
    return violation;
  }
}

/** The gate's recorded pipeline id — the pipeline output's `pipelineId` knob,
 *  null when the gate never saw a pipeline (or recorded a non-numeric one). */
const recordedPipelineId = (output: Record<string, unknown> | null): number | null => {
  const raw = output?.["pipelineId"];
  return typeof raw === "number" && Number.isInteger(raw) && raw > 0 ? raw : null;
};
