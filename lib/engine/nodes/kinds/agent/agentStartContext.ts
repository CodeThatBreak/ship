import "server-only";

import { z } from "zod";
import { FACT_KIND } from "../../../facts/types/facts";
import type { FlowCtx } from "../../shared/nodeSharedExports";
import type { FlowContextHelper } from "../../shared/nodeSharedExports";
import type { AgentDef } from "../../schemas/declarativeSchemas";
import { composeAgentPrompt, renderAgentPrompt, resolveAgentModel } from "./agentPrompt";
import { resolveStartingRef } from "./baseRefResolver";
import { redactSecretValues, resolveSecretContext } from "./secretRefs";

/** Everything a fresh agent run start needs, resolved once before the runner
 *  starts (the run/chat/executeRetry trio share the same seams — tasks 03,
 *  08, 15). Extracted from `AgentTemplateNode.run` so the kind file stays a
 *  thin orchestrator. */
export type AgentStartContext = Awaited<ReturnType<typeof prepareAgentStart>>;

export const prepareAgentStart = async (
  ctx: FlowCtx,
  rawInput: Record<string, unknown>,
  cfg: AgentDef,
  label: string,
  outputSchema: z.ZodType<Record<string, unknown>>,
  ctxHelper: FlowContextHelper,
) => {
  const model = await resolveAgentModel(ctx, rawInput, cfg);
  // Task 15 (C1): the declared refs resolve ONCE per run — the values ride
  // the env channel and the {{secrets.NAME}} prompt resolver, while the
  // recorded input keeps the {{...}} refs (never the values). A declared
  // ref with no configured value throws here, before any agent starts.
  const secrets = await resolveSecretContext(cfg.secret_refs, label);
  const { body, source } = await renderAgentPrompt(ctx, rawInput, cfg, label, {
    resolveSecret: secrets.resolver,
  });
  const prompt = composeAgentPrompt(body, cfg, outputSchema);
  const startingRef = await resolveStartingRef(ctx, cfg);
  // Task 08: the attribution anchor — the resolved base_ref pinned to the
  // commit it pointed at at run start (the ctxHelper's read-only seam, the
  // makeDiff sibling). Git I/O under the claim, never in a transaction;
  // skipped entirely when the def declares no `diff` fact (F4).
  const baseSha = cfg.produces.includes(FACT_KIND.DIFF)
    ? await ctxHelper.baseShaOf(ctx, startingRef)
    : null;

  const input: Record<string, unknown> = {
    ...rawInput,
    prompt: redactSecretValues(prompt, secrets.env),
    prompt_source: source,
    model,
  };

  return { model, secrets, prompt, startingRef, baseSha, input };
};
