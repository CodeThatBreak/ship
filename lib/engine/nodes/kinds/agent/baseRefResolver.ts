import "server-only";

import { buildFlowContext } from "../../../context/flowVariables";
import type { AgentDef } from "../../schemas/declarativeSchemas";
import type { FlowCtx } from "../../shared/nodeSharedExports";
import { TemplateRenderer } from "../../shared/nodeSharedExports";

/**
 * The ONE starting-ref resolver for the agent kind (Task 03, finding E2):
 * every run surface — fresh `run`, chat follow-up, and the output-contract
 * feedback retry — starts its agent from the same ref. The declared
 * `base_ref` wins (rendered against the flow context at run time, so it may
 * be a `{{...}}` ref); a null/blank `base_ref` — or one whose refs render
 * empty — falls back to the flow's MR branch (the kind's previous default);
 * a flow without an MR branch starts undefined (the runner's default).
 */
export const resolveStartingRef = async (ctx: FlowCtx, cfg: AgentDef): Promise<string | undefined> => {
  const declared = typeof cfg.base_ref === "string" ? cfg.base_ref.trim() : "";
  if (declared) {
    const rendered = TemplateRenderer.render(declared, await buildFlowContext(ctx)).trim();
    if (rendered) return rendered;
  }
  const mrBranch = ctx.flow.mrBranch;
  if (mrBranch == null || mrBranch === "") return undefined;
  return mrBranch;
};
