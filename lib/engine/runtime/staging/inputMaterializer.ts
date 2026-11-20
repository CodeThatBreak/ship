import "server-only";

import { buildFlowContext } from "../../context/flowVariables";
import { EVENT_KIND } from "../../constants/vocabulary";
import type { FlowCtx } from "../../nodes/shared/nodeSharedExports";
import { templateStore } from "../../templates/templateStore";
import type { TransitionEvents } from "../transitions/transitionEvents";
import type { StageRunnerHost } from "../flowEngineHost";

/**
 * InputMaterializer — the staging cluster's input half: the upstream outputs
 * a node inherits when a `next` edge feeds it (its parents' outputs merged
 * over the flow context) plus the split payload's unit — everything a run's
 * `{{input.*}}` map is built from before the node's `consumes` check hands
 * off (step 04 validates that at stage start).
 *
 * Invariants (step 04, decision Q8): several parents publishing the same key
 * keep the documented last-wins semantics — but the collision stops hiding:
 * the log names the key and every producer.
 *
 * Must never: write status, start a stage, or invent input the node's
 * contract did not declare.
 */
export class InputMaterializer {
  constructor(
    private readonly host: StageRunnerHost,
    private readonly events: TransitionEvents,
  ) {}

  /**
   * The upstream outputs a node inherits when a `next` edge feeds it (its
   * parents' outputs merged over the flow context) plus the split payload's
   * unit. Public because the manual trigger path (`runNodeManual`) must hand a
   * declarative run the same input the engine's auto start does — otherwise
   * `{{input.*}}` renders empty for a node started from the runtime panel.
   */
  async inheritedInput(flowId: string, nodeKey: string, ctx: FlowCtx): Promise<Record<string, unknown>> {
    const parents = ((await templateStore.graphForFlow(flowId))?.edges ?? [])
      .filter((e) => e.kind === "next" && e.to === nodeKey)
      .map((e) => e.from);
    const nodesMap = (await buildFlowContext(ctx)).nodes;
    const out: Record<string, unknown> = {};
    const producers = new Map<string, string[]>();
    for (const p of parents) {
      const output: Record<string, unknown> = (nodesMap[p] as { output?: Record<string, unknown> } | undefined)?.output ?? {};
      for (const key of Object.keys(output)) {
        out[key] = output[key];
        producers.set(key, [...(producers.get(key) ?? []), p]);
      }
    }
    // step 04 (decision Q8): several parents publishing the same key keep the
    // documented last-wins semantics — but the collision stops hiding: this
    // log names the key and every producer so the template author can fix the
    // overlap instead of guessing which value downstream consumed.
    const collisions = [...producers.entries()].filter(([, ps]) => ps.length > 1);
    if (collisions.length) {
      const described = collisions.map(([key, ps]) => `${key} (${ps.join(", ")})`).join(", ");
      await this.events.emit(flowId, nodeKey, EVENT_KIND.LOG,
        `${nodeKey}: inherited-input collision — several upstream outputs share keys, last writer wins: ${described}`,
        { nodeKey, collisions: collisions.map(([key, ps]) => ({ field: key, producers: ps })) });
    }
    // split children (agent-node split plan §2.1): the own unit rides the run
    // input — `{{input.unit.*}}` — alongside any inherited parent outputs
    // (only split children carry a unit on their trigger payload)
    const payload = ctx.flow.triggerPayload as { unit?: unknown } | null;
    if (payload?.unit != null) out.unit = payload.unit;
    return out;
  }
}
