import "server-only";

import { NODE_KEYS } from "../../constants/nodeKeys";
import type { EffectRegistry } from "../../runtime/effects/effectRegistry";
import type { SdlcChain } from "./sdlcChain";
import type { ChainHost } from "./types/chainHost";

/**
 * The SDLC builtin chain expressed as effect registrations (step 07,
 * Invariant 8): what happens after each chain stage finishes is DECLARED here
 * once, and the StageRunner / approval door consult the registry — the
 * sequencing is no longer spread across call ordering in the chain's trigger
 * bodies. The implementations stay in `sdlcChain.ts` (and the template edges
 * stay the actual stage-ordering data); these registrations name the chain's
 * ownership of each post-finish concern.
 *
 * Registrations (the registry snapshot test pins this exact set):
 * - pipeline (the CI gate) `afterSuccess` → the chain advances the template
 *   edges: gate green → review; the debounced resolve re-arms downstream.
 * - review `afterSuccess` → the edges: review done → resolve-if-open (the
 *   debounced resolve arms its comment wait when the edge activates).
 * - resolve `loopReentry` → the re-gate join: the loop edge's declared
 *   `when` (`nodes.resolve.output.pushed = true`, lint-checked against the
 *   resolve output schema — step 04) + the LoopJoin reset restart the gate.
 * - build `afterApproval` → the MR-create ordering (the CR-before-gate
 *   invariant): MR creation with the bounded commit-fix loop completes
 *   before the build → gate edge is advanced.
 */
export const registerSdlcEffects = (
  registry: EffectRegistry,
  host: ChainHost,
  chain: SdlcChain,
): void => {
  registry.register(NODE_KEYS.PIPELINE, {
    afterSuccess: async (ctx) => {
      await host.advanceFrom(ctx.flowId, ctx.nodeKey);
    },
  });
  registry.register(NODE_KEYS.REVIEW, {
    afterSuccess: async (ctx) => {
      await host.advanceFrom(ctx.flowId, ctx.nodeKey);
    },
  });
  registry.register(NODE_KEYS.RESOLVE, {
    loopReentry: async (ctx) => {
      await host.advanceFrom(ctx.flowId, ctx.nodeKey);
    },
  });
  registry.register(NODE_KEYS.BUILD, {
    afterApproval: (ctx) => {
      const branchName = typeof ctx.params?.branchName === "string" ? ctx.params.branchName : undefined;
      return chain.mrCreateSequence(ctx.flowId, ctx.nodeKey, branchName);
    },
  });
};
