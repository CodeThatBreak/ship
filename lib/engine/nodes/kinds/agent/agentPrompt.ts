import "server-only";

import { z } from "zod";
import { AGENT_OUTPUT_FORMAT } from "../../../constants/declarative";
import {
  PROMPT_SOURCE,
  TemplateRenderer,
  type FlowCtx,
  type PromptSource,
} from "../../shared/nodeSharedExports";
import { AgentOutputError } from "../../shared/agent/outputError/outputErrorExports";
import { buildFlowContext } from "../../../context/flowVariables";
import { untrustedData } from "../../../prompts/untrustedData";
import type { AgentDef } from "../../schemas/declarativeSchemas";

/**
 * The agent kind's prompt assembly (§3.11 `<kind>-prompt.ts`): the ONE place
 * the agent's final prompt bytes are built, shared by `run`, `chat` and
 * `previewPrompt` so the preview cannot drift from the run. Must never render
 * a prompt without the contract directive for a json output — the response
 * would be validated against a contract the agent never saw.
 */

/**
 * The agent-facing output-contract directive: the schema GENERATED FROM THE
 * CONTRACT — `z.toJSONSchema(outputSchema)` is byte-identical to the validator
 * the response is checked against (step 04). A json output without a declared
 * schema has no schema block: the contract is just "one JSON object" (the
 * record contract's semantics).
 */
export const agentContractDirective = (
  cfg: AgentDef,
  outputSchema: z.ZodType<Record<string, unknown>>,
): string => {
  const hasSchema = cfg.output_schema != null && typeof cfg.output_schema === "object";
  return AgentOutputError.directive(hasSchema ? z.toJSONSchema(outputSchema) : null);
};

/**
 * The prompt body + the output-contract directive, composed in ONE place so
 * every surface (fresh run, chat follow-up, the bounded retry) appends the
 * same bytes. A body with nothing to append comes back byte-identical (no
 * compose round-trip).
 */
export const composeAgentPrompt = (
  body: string,
  cfg: AgentDef,
  outputSchema: z.ZodType<Record<string, unknown>>,
): string => {
  if (cfg.output !== AGENT_OUTPUT_FORMAT.JSON) return body;
  return TemplateRenderer.compose(body)
    .addBlankLine()
    .addBlankLine()
    .addLine(agentContractDirective(cfg, outputSchema))
    .build();
};

/**
 * Render the run input into the prompt body (pre-contract). The run input's
 * `prompt` (chat-modal re-run) wins over the template config's `prompt`; at
 * least one must be present — an empty template is a loud config error, never
 * an empty agent turn.
 *
 * The inherited run input is prompt-addressable: `{{input.<field>}}` refs the
 * previous node's output fields directly (the node inherits the parent's
 * contract); the engine-owned `prompt`/`model` keys are stripped from it.
 * The values are untrusted upstream output — top-level string values ride
 * the shared untrusted-data fence; non-strings stay intact so nested
 * `{{input.<field>.<sub>}}` refs keep resolving.
 *
 * The returned `source` records where the prompt came from (modal | config |
 * default) so the run record can annotate lastRun in the modal.
 *
 * The optional `secretResolver` scopes `{{secrets.NAME}}` to the node's
 * DECLARED refs (task 15, C1): an undeclared ref and a declared-but-unset
 * ref both fail the run loudly — the renderer's no-resolver `""` fallback
 * never applies on this path, because the resolver is always supplied by a
 * caller that owns the declared-ref set (the preview declines to resolve and
 * keeps today's no-resolver behavior — values must not reach the preview).
 */
export const renderAgentPrompt = async (
  ctx: FlowCtx,
  rawInput: Record<string, unknown>,
  cfg: AgentDef,
  label: string,
  opts?: { resolveSecret?: (name: string) => string | null | undefined },
): Promise<{ body: string; source: PromptSource }> => {
  const { prompt: inputPrompt, model: _, ...inheritedInput } = rawInput;
  void _;

  const promptBody = typeof inputPrompt === "string" ? inputPrompt.trim() : "";
  const template = promptBody || cfg.prompt;

  if (!template.trim()) {
    throw new Error(`${label}: no prompt configured — set one in the template editor`);
  }
  // The flow variable universe is async (it reads the nodes' outputs) —
  // awaited, never spread as a promise
  const promptWithoutContract = TemplateRenderer.render(template, {
    ...(await buildFlowContext(ctx)),
    input: Object.fromEntries(
      Object.entries(inheritedInput).map(([field, value]) => [
        field,
        typeof value === "string" && value
          ? untrustedData({ source: `input.${field}`, text: value }).text
          : value,
      ]),
    ),
  }, { label, ...opts });

  // the run record's input.prompt is the RENDERED final prompt — the exact
  // text the agent receives (nodes.config.prompt stays the un-rendered source
  // of truth) — plus where it came from, so the modal can annotate lastRun
  const source: PromptSource = promptBody
    ? PROMPT_SOURCE.MODAL
    : cfg.prompt
      ? PROMPT_SOURCE.CONFIG
      : PROMPT_SOURCE.DEFAULT;

  return { body: promptWithoutContract, source };
};

/**
 * Chat feedback rendering: the developer's chat message rides the SAME flow
 * variable universe a fresh run's template does — rendered before the
 * contract directives are composed on top, so the follow-up output goes
 * through the same contract validation a fresh run's does. The optional
 * `secretResolver` scopes `{{secrets.NAME}}` to the node's declared refs
 * (task 15) — same scoping as `renderAgentPrompt`.
 */
export const renderAgentFeedback = async (
  ctx: FlowCtx,
  content: string,
  opts?: { resolveSecret?: (name: string) => string | null | undefined },
): Promise<string> =>
  TemplateRenderer.render(content, await buildFlowContext(ctx), opts);

/**
 * Model resolution: the run input's `model` overrides the config's, and
 * either may be a `{{...}}` ref (an upstream node that picks the model) —
 * rendered against the flow context at run time. Null when neither side
 * names a model (the runner's default applies).
 */
export const resolveAgentModel = async (
  ctx: FlowCtx,
  rawInput: Record<string, unknown>,
  cfg: AgentDef,
): Promise<string | null> => {
  const { model: inputModel } = rawInput;

  const runModel = typeof inputModel === "string" && inputModel.trim() ? inputModel.trim() : null;
  const modelTemplate = runModel ?? cfg.model ?? null;
  return modelTemplate ? TemplateRenderer.render(modelTemplate, await buildFlowContext(ctx)).trim() : null;
};
