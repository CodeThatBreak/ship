import { z } from "zod";
import type { AgentRunResult } from "../../../ports/agent-port";
import { PlanStepRow, rows, type NodeRow } from "../../../../db/rows";
import { prompts, sectionsOf, type PromptSections as PromptSectionsLike } from "../../../prompts/prompt-library";
import { planSteps } from "../../../runtime/plan-step-store";
import {
  AgentRunNode,
  TemplateRenderer,
  nodeRoles,
  type FlowCtx,
  type NodePromptPreview,
  type PromptPreviewParams,
  type RunOutcome,
  type SplitUnit,
} from "../../shared";
import type { NodeCapabilities } from "../../shared/capabilities";
import { NODE_KEYS } from "../../../constants/node-keys";
import type { ConfigField } from "../../../templates/node-config";
import { DEFAULT_MCP_SOURCES, configString, mcpSourcesOf, mcpSourcesSchema, mcpSourceConfigFields, type SettingSource } from "../../../templates/node-config";
import { AGENT_OUTPUT_ERROR, AgentOutputError, type AgentOutputErrorCode } from "../../shared/agent/output-error";
import { extractJson } from "../agent/json-schema-lite";
import {
  PLAN_RESPONSE_JSON_SCHEMA,
  SUB_PLAN_RESPONSE_JSON_SCHEMA,
  PlanResponse,
  SubPlanResponse,
  withStepIds,
  PlanInput,
  PlanOutput,
  type PlanMeta,
  type PlanStep,
} from "./schema";

// ── context block registry (§4) ──────────────────────────────────────────────

export type ContextBlockId = "task" | "contract" | "current" | "branches" | "versions" | "edits";

export interface ContextBlockSpec {
  id: ContextBlockId;
  label: string;
  description: string;
  /** default-on for scoped (branch) refines */
  scopedDefault: boolean;
  /** default-on for whole-plan refines */
  wholeDefault: boolean;
  /** the engine always includes this block — the UI shows it locked */
  pinned?: boolean;
}

/**
 * The picker data + assembly registry. Defaults are the minimal-context
 * recommendation (§3): small context in → small output out. The picker's job is
 * to show what the model sees and allow EXPANSION, not to tempt users into
 * pruning.
 */
export const CONTEXT_BLOCKS: ContextBlockSpec[] = [
  {
    id: "task",
    label: "Task context",
    description: "PRD, Figma links, acceptance criteria",
    scopedDefault: true,
    wholeDefault: true,
  },
  {
    id: "contract",
    label: "Branch contract",
    description:
      "Scope, files and dependencies of the branch being refined — locked: removing it would let the agent silently change the branch's scope",
    scopedDefault: true,
    wholeDefault: false,
    pinned: true,
  },
  {
    id: "current",
    label: "Current sub-plan",
    description:
      "This branch's current sub-plan prompt + live checklist rows — your hand edits are included and the refine preserves them",
    scopedDefault: true,
    wholeDefault: false,
  },
  {
    id: "branches",
    label: "Other branches",
    description: "Sibling branches as title + scope summaries only",
    scopedDefault: false,
    wholeDefault: true,
  },
  {
    id: "versions",
    label: "Plan versions",
    description: "Earlier full plan versions (~3k chars each — large; watch the char count)",
    scopedDefault: false,
    wholeDefault: false,
  },
  {
    id: "edits",
    label: "Hand edits",
    description:
      "Your live checklist edits across all branches, passed as intent the refine must respect (whole-plan refines only; scoped refines cover hand edits via Current sub-plan)",
    scopedDefault: false,
    wholeDefault: true,
  },
];

/** Fixed assembly order so prompts stay comparable across runs (§4). */
const CONTEXT_BLOCK_ORDER: ContextBlockId[] = ["task", "contract", "current", "branches", "versions", "edits"];

/** A resolved context block, as reported to the prompt route / picker. */
export interface ContextBlockInfo {
  id: ContextBlockId;
  label: string;
  description: string;
  /** rendered preview (what the model would see for this block) */
  text: string;
  chars: number;
  defaultOn: boolean;
  locked: boolean;
}

// ── merge logic (§5) — pure, deterministic ───────────────────────────────────

/**
 * Replace exactly one branch's sub-plan + its top-level steps. Everything else
 * stays byte-identical. The code, not the prompt, enforces "don't touch what
 * wasn't asked about".
 */
export function mergeBranchRefine(meta: PlanMeta, branchName: string, sub: SubPlanResponse): PlanMeta {
  const idx = meta.branches.findIndex((b) => b.name === branchName);
  if (idx === -1) throw new Error(`branch "${branchName}" not found`);

  // 1. Keep the agent's step ids unless they collide with steps we keep —
  //    unchanged steps retain identity, which is what makes the id-based diff
  //    (§6) meaningful. (Blanket re-id would give every incoming step a fresh
  //    id, so even a "reuse s2" step would surface as remove+add in the diff.)
  const taken = new Set(meta.steps.filter((s) => s.branch !== branchName).map((s) => s.id));
  const reId = (s: PlanStep, i: number) => {
    let id = s.id?.trim() || `s${i + 1}`;
    if (taken.has(id)) {
      let n = taken.size + 1;
      while (taken.has(`s${n}`)) n++;
      id = `s${n}`;
    }
    taken.add(id);
    return { ...s, id, branch: branchName };
  };
  const newSteps = sub.steps.map(reId);

  // 2. Splice into the top-level step list IN PLACE (keep global ordering):
  //    remove the old steps of this branch, insert new ones at the same position.
  const firstOld = meta.steps.findIndex((s) => s.branch === branchName);
  const kept = meta.steps.filter((s) => s.branch !== branchName);
  const keptBefore = firstOld === -1 ? kept.length : firstOld;
  // slice(0, firstOld) cannot contain this branch's steps — firstOld is the
  // FIRST branch step, so everything before it is kept verbatim.
  kept.splice(keptBefore, 0, ...newSteps);
  const steps = kept;

  // 3. Update the branch record: titles, scoped markdown, subPlan (prompt
  //    preserved — the agent doesn't return a revised one in v1).
  const branches = meta.branches.map((b) =>
    b.name === branchName
      ? {
          ...b,
          steps: newSteps.map((s) => s.title),
          markdown: sub.markdown,
          subPlan: b.subPlan ? { ...b.subPlan, steps: newSteps } : undefined,
        }
      : b
  );

  return { steps, branches };
}

// ── step diff (§6) — id-based with a title fallback ──────────────────────────

const stepContentEqual = (a: PlanStep, b: PlanStep) =>
  a.title === b.title &&
  a.detail === b.detail &&
  JSON.stringify(a.files ?? []) === JSON.stringify(b.files ?? []);

/**
 * Classify a branch's old-vs-new steps. Pairing is id-based (§5 preserves ids
 * for unchanged steps); leftover pairs that match by title (agents occasionally
 * rename ids on unchanged steps) are promoted to `changed`; anything still
 * unmatched stays `added`/`removed`.
 */
export function diffBranchSteps(
  oldSteps: PlanStep[],
  newSteps: PlanStep[]
): {
  added: PlanStep[];
  removed: PlanStep[];
  changed: { id: string; before: PlanStep; after: PlanStep }[];
} {
  const byId = (arr: PlanStep[]) =>
    new Map(arr.filter((s): s is PlanStep & { id: string } => Boolean(s.id)).map((s) => [s.id, s]));
  const oldById = byId(oldSteps);
  const newById = byId(newSteps);

  const added: PlanStep[] = [];
  const changed: { id: string; before: PlanStep; after: PlanStep }[] = [];
  for (const [id, next] of newById) {
    const prev = oldById.get(id);
    if (!prev) added.push(next);
    else if (!stepContentEqual(prev, next)) changed.push({ id, before: prev, after: next });
  }

  // leftovers: old ids absent from the new version
  const leftoversOld = [...oldById.values()].filter((s) => !newById.has(s.id));
  const removed: PlanStep[] = [];
  for (const o of leftoversOld) {
    // title fallback: an id was renamed but the step itself is unchanged
    const idx = added.findIndex((n) => n.title === o.title && stepContentEqual(o, n));
    if (idx >= 0) {
      changed.push({ id: `${o.id ?? "?"} → ${added[idx].id ?? "?"}`, before: o, after: added[idx] });
      added.splice(idx, 1);
    } else {
      removed.push(o);
    }
  }
  return { added, removed, changed };
}

// ── the node ─────────────────────────────────────────────────────────────────

/** Output-contract failures a feedback turn can fix: missing or schema-
 *  violating JSON. `agent_reported` never retries — the agent explicitly said
 *  it cannot comply, and its reason goes to the user (chat refinement), not
 *  back to the agent. (The agent-node standard.) */
const RETRYABLE_OUTPUT_ERRORS: ReadonlySet<AgentOutputErrorCode> = new Set([
  AGENT_OUTPUT_ERROR.NO_JSON,
  AGENT_OUTPUT_ERROR.SCHEMA_MISMATCH,
]);

/** What a plan-mode agent run (initial or retry) needs beyond its prompt. */
interface PlanRunArgs {
  label: string;
  model: string | null;
  customSubagents: { name: string; instructions: string }[] | undefined;
  settingSources: SettingSource[];
}

export class PlanNode extends AgentRunNode<PlanInput, PlanOutput> {
  readonly key = NODE_KEYS.PLAN;
  readonly label = "Plan";
  readonly promptKeys = ["plan", "plan_refine", "plan_subplan_refine"] as const;
  /** the settings page's editable plan section (the other keys are run-time sub-templates) */
  readonly promptSections = ["plan"] as const;
  readonly order = 10;
  readonly edges = [[NODE_KEYS.BUILD, "next"]] as const;

  /**
   * The plan is the chat's first-class node: refine mode, the prompt preview
   * before the first run, and the panel title (the chat panel keys all of
   * this off these capabilities — no node-key checks).
   */
  override readonly capabilities: NodeCapabilities = {
    refinable: true,
    chatOnlyMode: "refine",
    promptNode: NODE_KEYS.PLAN,
    panelTitle: "Implementation plan",
  };

  /** Engine-dispatch metadata (§T3): the plan approval is a built-in flow
   *  action (refine), the plan kind occupies the chain's plan role, and the
   *  "plan" artifact is the first-class resource the editor/approvals consume. */
  override readonly builtinApproval = true;
  override readonly chainRole = NODE_KEYS.PLAN;
  override readonly resourceArtifacts = [NODE_KEYS.PLAN] as const;

  readonly inputSchema = PlanInput;
  readonly outputSchema = PlanOutput;

  /** Typed config knobs (defaults = today's behavior). */
  readonly configSchema = z.object({
    /** user-editable prompt body (foldable per template/flow; the global overlay was removed) */
    prompt_body: z.string().optional(),
    /**
     * User-added rules appended after the prompt body, before the engine's
     * locked internal blocks (rules + output contract + run data) — for every
     * run of this node (template runs, config-body runs and modal-edited runs
     * alike). The prompt modal previews and edits it via set_node_config.
     */
    prompt_rules: z.string().optional(),
    /** default for starts that don't pass `decompose` explicitly */
    decompose_default: z.boolean().default(false),
    /**
    /**
     * Plan fan-out (§1 "who decides the mode"): the published execution
     * resolution. `follow` = the PLANNER decides per plan version — the
     * plan prompt gains the execution directive and the response's
     * `execution` + `execution_rationale` are published in plan-meta
     * (unknown/missing ⇒ whole, never a parse failure). Its "steps" choice
     * fans the plan's branches out as one child flow per branch via the
     * split runtime (overridable at approve). The legacy knob value
     * "steps" (per-step child flows) is retired — old configs still
     * carrying it surface through executionDefault and now mean the same
     * per-branch fan-out. The published value rides every plan version in
     * `artifacts.meta.execution` (source: knob | planner | default |
     * override), and the plan panel offers the override at approve.
     */
    execution_default: z.enum(["whole", "follow"]).default("whole"),
    /** ambient MCP servers for plan agent runs — defaults to ALL sources enabled */
    mcp_sources: mcpSourcesSchema.default(DEFAULT_MCP_SOURCES),
  });
  readonly configFields = [
    { key: "prompt_body", label: "Prompt body", type: "text", help: "User-editable prompt body; internal output contracts are appended automatically." },
    { key: "prompt_rules", label: "Your rules", type: "text", help: "Extra rules appended after the prompt body, before the engine's locked instructions (output contract, run data) — on every run of this node. E.g. \"always ask before assuming a framework\"." },
    { key: "decompose_default", label: "Decompose by default", type: "boolean", help: "Run repo-exploration sub-agents by default." },
    {
      key: "execution_default", label: "Execution resolution", type: "select",
      help:
        "How the work after this plan executes once approved: whole (one run — the default), follow "
        + "(the planner decides per plan version — its \"steps\" choice fans the plan's branches out as one child flow per branch via the split runtime, overridable at approve).",
      options: [
        { value: "whole", label: "whole", description: "Everything executes as one run (default)" },
        { value: "follow", label: "follow", description: "The planner decides per plan version — \"steps\" fans the branches out as one child flow per branch (overridable at approve)" },
      ],
    },
    ...mcpSourceConfigFields,
  ] as const satisfies readonly ConfigField[];

  async run(ctx: FlowCtx, input: PlanInput, config: Record<string, unknown>): Promise<RunOutcome> {
    // the template/flow-layer prompt body knob folds into the existing
    // user-body path (per-run input.prompt still wins)
    if (!input.prompt && typeof config.prompt_body === "string" && config.prompt_body.trim()) {
      input = { ...input, prompt: config.prompt_body, promptIsBody: true };
    }
    // the user's standing rules (prompt_rules knob) apply to every run —
    // template runs, config-body runs and modal-edited runs alike
    const userRules = typeof config.prompt_rules === "string" ? config.prompt_rules : "";
    const node = this.node(ctx);

    // Branch-scoped path (§2/§3): refine ONE branch's sub-plan.
    const scoped = input.branchRef ? this.prepareScopedRefine(ctx, input) : null;
    if (input.branchRef && !scoped) {
      // Edge case (§9): branchRef on a plan without branches or an unknown
      // branch name → fall back to a whole-plan refine with a lifecycle note,
      // never hard-fail.
      this.support.emitLifecycle(
        ctx.flow.id, node.id,
        `branch "${input.branchRef}" not found in the current plan — refining the whole plan instead`,
      );
    }

    const prompt = scoped
      ? this.buildScopedPrompt(ctx, scoped, input, userRules)
      : this.buildPlanPrompt(ctx, node, input, userRules);
    const hasAgent = Boolean(node.agent_id);

    // Whole-plan refine follows up by default (the conversation holds the
    // decomposition rationale); `fresh` is the quality escape hatch (§3).
    // Scoped refines are fresh by default: their template is self-contained,
    // and a follow-up biases the model toward its earlier decisions.
    const scopedFresh = input.fresh ?? true;
    const followUpOn = scoped
      ? scopedFresh
        ? null
        : node.agent_id ?? null
      : input.fresh === true
        ? null
        : input.feedback && hasAgent
          ? node.agent_id
          : null;
    const args: PlanRunArgs = {
      label: scoped
        ? `sub-plan refine (${scoped.branch.name}${scopedFresh ? ", fresh" : ""})`
        : input.feedback && hasAgent
          ? "plan refine"
          : "plan",
      model: input.model,
      customSubagents: this.decomposeSubagents(ctx, input),
      settingSources: mcpSourcesOf(config),
    };

    return this.execute(ctx, {
      // the run record: `input.prompt` is the exact final prompt (retry
      // fidelity + the modal's lastRun read from it)
      input: { ...input, prompt },
      prompt,
      agent: {
        mode: "plan",
        name: `${args.label} ${ctx.task.key}`,
        followUpOn,
        model: args.model,
        customSubagents: args.customSubagents,
        settingSources: args.settingSources,
      },
      label: args.label,
      finalize: (result) => this.applyPlanOutputWithRetry(ctx, node, input, scoped, result, args),
    });
  }

  // ── scoped refine preparation (Phase A) ───────────────────────────────────

  /** Everything the scoped refine needs, or null when it must fall back. */
  private prepareScopedRefine(ctx: FlowCtx, input: Pick<PlanInput, "branchRef">) {
    const latest = this.latestPlan(ctx.flow.id);
    const branch = input.branchRef
      ? latest?.meta.branches.find((b) => b.name === input.branchRef)
      : undefined;
    if (!latest || !branch) return null;
    // Live checklist rows for THIS branch — hand edits are part of the
    // refine's input by construction (§2).
    const liveRows = this.liveRows(ctx.flow.id).filter((s) => s.branch === branch.name);
    return { latest, branch, liveRows };
  }

  // ── output contract: apply with one bounded retry (the agent-node pattern) ─

  /**
   * Apply the plan output contract with one bounded self-heal: when the
   * response misses the contract (`no_json` / `schema_mismatch`), re-prompt
   * the SAME agent once with the violations as feedback and re-apply the
   * contract. A second miss throws the standard {@link AgentOutputError} and
   * fails the node loudly — the previous artifact version stays the latest
   * plan, and the developer retries.
   */
  private async applyPlanOutputWithRetry(
    ctx: FlowCtx,
    node: NodeRow,
    input: PlanInput,
    scoped: ScopedRefine | null,
    result: AgentRunResult,
    args: PlanRunArgs,
  ): Promise<RunOutcome> {
    try {
      return this.applyPlanResponse(ctx, node, input, result.result ?? "", scoped);
    } catch (e: unknown) {
      if (!(e instanceof AgentOutputError) || !RETRYABLE_OUTPUT_ERRORS.has(e.code)) throw e;
      return this.retryPlanOutput(ctx, node, input, scoped, e, args);
    }
  }

  /**
   * One feedback turn on the same agent session (`followUpOn` = the run the
   * contract just failed), then re-apply the contract to its response. The
   * scoped retry re-appends the scoped directive — a scoped retry never
   * re-emits the full plan.
   */
  private async retryPlanOutput(
    ctx: FlowCtx,
    node: NodeRow,
    input: PlanInput,
    scoped: ScopedRefine | null,
    failure: AgentOutputError,
    args: PlanRunArgs,
  ): Promise<RunOutcome> {
    // the specific failure is the feedback: what the agent got wrong, in its
    // own response's terms — the same human messages the trail shows
    const feedback =
      failure.code === AGENT_OUTPUT_ERROR.NO_JSON
        ? TemplateRenderer
            .compose("Your previous response could not be used: no JSON object could be parsed from it.")
            .addBlankLine()
            .addLine("Re-emit your ENTIRE response as a single JSON object.")
        : TemplateRenderer
            .compose("Your previous response was valid JSON but violated the output contract:")
            .addBlankLine()
            .addLines(failure.detail.issues.map((i) => `  - ${i.path ? `${i.path}: ` : ""}${i.message}`))
            .addBlankLine()
            .addLine(scoped ? "Re-emit ONLY your sub-plan response as a single JSON object." : "Re-emit the corrected JSON object.");

    this.support.emitLifecycle(
      ctx.flow.id, node.id,
      `${args.label} output contract failed — retrying with feedback (${failure.code})`,
    );

    const retryPrompt = this.composePlanPrompt(feedback.build(), scoped != null);
    const retry = await this.runner.executeRun(
      ctx,
      node.id,
      () =>
        this.runner.startAgent(ctx, {
          prompt: retryPrompt,
          mode: "plan",
          name: `${args.label} ${ctx.task.key}`,
          followUpOn: this.support.lastAgentId(node.id),
          model: args.model,
          customSubagents: args.customSubagents,
          settingSources: args.settingSources,
        }),
      `${args.label} retry`,
    );
    return this.applyPlanResponse(ctx, node, input, retry.result ?? "", scoped);
  }

  /**
   * Validate the agent's text against the plan response contract, then do the
   * plan-domain work and build the outcome. Throws the standard
   * {@link AgentOutputError} on no JSON, the agent's error envelope, or schema
   * violations. The artifact is saved HERE, not via `outcome.artifact`: the
   * output blob derives from the just-saved artifact row (id, version,
   * execution/scopedRefine provenance) — `applyOutcome` persists the rest.
   */
  private applyPlanResponse(
    ctx: FlowCtx,
    node: NodeRow,
    input: PlanInput,
    text: string,
    scoped: ScopedRefine | null,
  ): RunOutcome {
    if (scoped) return this.applyScopedPlanResponse(ctx, node, text, scoped);

    const plan = this.parsePlanResponse(text, PlanResponse);
    const planMeta: PlanMeta = { steps: withStepIds(plan.steps), branches: plan.branches ?? [] };
    const { art, stepCount } = this.persistPlan(
      ctx, node, input, plan.markdown, planMeta, this.normalizePlannerExecution(plan),
    );
    return this.planOutcome(art, planMeta, stepCount, plan.markdown);
  }

  /** The scoped refine's tail: deterministic merge → new artifact version
   *  (plan markdown unchanged) → scoped checklist sync → awaiting approval. */
  private applyScopedPlanResponse(
    ctx: FlowCtx,
    node: NodeRow,
    text: string,
    scoped: ScopedRefine,
  ): RunOutcome {
    const sub = this.parsePlanResponse(text, SubPlanResponse);
    const branchName = scoped.branch.name;

    // Deterministic merge: everything outside this branch stays byte-identical.
    const merged = mergeBranchRefine(scoped.latest.meta, branchName, sub);
    const art = this.support.saveArtifact(node.id, ctx.flow.id, "plan", scoped.latest.art.content, {
      ...scoped.latest.rawMeta,
      steps: merged.steps,
      branches: merged.branches,
      scopedRefine: { branch: branchName, from: scoped.latest.art.version }, // provenance for the diff banner
    });

    // Sync the live checklist scoped, not wholesale (§5): rows of other
    // branches are never touched; this branch's hand edits were already part
    // of the refine's input — they come back as echoed intent, not clobbered
    // state.
    const stepCount = planSteps.replaceBranch(
      ctx.flow.id, art.id, branchName,
      merged.steps.filter((s) => s.branch === branchName),
    );

    const oldSteps = scoped.latest.meta.steps.filter((s) => s.branch === branchName);
    const { added, removed, changed } = diffBranchSteps(oldSteps, sub.steps);
    const diffNote = `(+${added.length} / −${removed.length}${changed.length ? `, ${changed.length} changed` : ""})`;

    return {
      status: "awaiting_approval",
      output: {
        latestArtifact: art.id,
        version: art.version,
        branches: merged.branches,
        steps: merged.steps,
        scopedRefine: { branch: branchName, from: scoped.latest.art.version },
      },
      event: `branch '${branchName}' sub-plan refined · ${stepCount} steps ${diffNote} — other branches untouched`,
      reply: sub.markdown,
    };
  }

  /** Validate one plan-mode response against its schema. Throws the standard
   *  {@link AgentOutputError}: `no_json`, the agent's error envelope
   *  (`agent_reported`), or `schema_mismatch` carrying every violation — the
   *  run trail shows what actually came back. */
  private parsePlanResponse<T>(text: string, schema: z.ZodType<T>): T {
    const parsed = extractJson(text);
    if (parsed == null) {
      throw new AgentOutputError({
        code: AGENT_OUTPUT_ERROR.NO_JSON,
        label: this.label,
        message: `${this.label}: the agent response contained no JSON — the plan response must be a single JSON object`,
        issues: [],
        response: text,
      });
    }
    // the agent's escape hatch: it answered with the standard error envelope
    // instead of contract-conforming output — convey its reason
    const reported = AgentOutputError.reported(parsed);
    if (reported != null) {
      throw new AgentOutputError({
        code: AGENT_OUTPUT_ERROR.AGENT_REPORTED,
        label: this.label,
        // the agent's reason is the headline — its words, conveyed to the user
        message: `${this.label}: ${reported.reason}`,
        issues: [],
        reported,
        response: text,
      });
    }
    const result = schema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
      throw new AgentOutputError({
        code: AGENT_OUTPUT_ERROR.SCHEMA_MISMATCH,
        label: this.label,
        // the first violation stays the headline — the same human message the
        // old validator produced, now with every issue in the structured payload
        message: issues[0]?.message ?? `${this.label}: the plan response violated its schema`,
        issues,
        response: text,
      });
    }
    return result.data;
  }

  /** The plan output contract appended to a retry prompt: the schema the
   *  response must satisfy + the agent's error-envelope escape hatch (the
   *  same directive json-output agent nodes ride). */
  private composePlanPrompt(body: string, scoped: boolean): string {
    return TemplateRenderer.compose(body)
      .addBlankLine()
      .addBlankLine()
      .addLine(AgentOutputError.directive(scoped ? SUB_PLAN_RESPONSE_JSON_SCHEMA : PLAN_RESPONSE_JSON_SCHEMA))
      .build();
  }

  /** The whole-plan outcome: awaiting approval, the output blob pointing at
   *  the fresh artifact version, the lifecycle event. */
  private planOutcome(
    art: { id: string; version: number },
    planMeta: PlanMeta,
    stepCount: number,
    text: string,
  ): RunOutcome {
    const branchNote = planMeta.branches.length
      ? ` (${planMeta.branches.length} branch${planMeta.branches.length > 1 ? "es" : ""})`
      : "";
    const stepNote = stepCount ? ` · ${stepCount} steps` : "";
    return {
      status: "awaiting_approval",
      output: {
        latestArtifact: art.id,
        version: art.version,
        ...(planMeta.branches.length ? { branches: planMeta.branches } : {}),
        ...(planMeta.steps.length ? { steps: planMeta.steps } : {}),
      },
      event: `plan v${art.version} ready for review${branchNote}${stepNote}`,
      reply: text,
    };
  }

  // ── prompts ────────────────────────────────────────────────────────────────

  /** Whole-plan prompt: verbatim override, refine template, or base + feedback. */
  private buildPlanPrompt(ctx: FlowCtx, node: NodeRow, input: PlanInput, userRules: string): string {
    const hasAgent = Boolean(node.agent_id);
    const baseCtx = { ticket: this.ctxHelper.taskContext(ctx), ticket_type: this.ctxHelper.taskLabel(ctx) };
    const refining = Boolean(input.feedback) || Boolean(input.prompt);
    const contextBlock = this.assembleContext(ctx, input, null, {
      // the base template already renders {{ticket}} — a task context block
      // earns its place only on refinement prompts (+ branch refines)
      skip: refining ? [] : ["task"],
    });
    // Phase 3B (`execution_default: follow`): the planner decides how the
    // checklist executes. The directive is an APPENDED block — the default
    // templates (and every non-follow prompt) stay byte-for-byte; the block
    // rides the base/refine/promptIsBody paths so an "Edit prompt" run keeps
    // the output contract. The raw verbatim-prompt path is untouched
    // (feedback-echo refines skip it by definition).
    const execBlock = this.executionDirective(ctx);

    if (input.prompt) {
      return input.promptIsBody
        ? prompts.assemblePrompt("plan", baseCtx, { context: contextBlock }, { body: input.prompt, userRules }).final
            + (execBlock ? `\n\n${execBlock}` : "")
        : input.prompt;
    }
    if (input.feedback && hasAgent) {
      const refined = prompts.resolve("plan_refine", baseCtx, { feedback: input.feedback, context: contextBlock }, undefined, { userRules });
      return execBlock ? `${refined}\n\n${execBlock}` : refined;
    }
    const base = prompts.resolve("plan", baseCtx, { context: contextBlock }, undefined, { userRules });
    let prompt = base + (input.feedback ? `\n\nAdditional instructions from the developer:\n${input.feedback}` : "");

    if (input.decompose) {
      prompt +=
        this.ctxHelper.execMode(ctx) === "local"
          ? "\n\nUse your built-in Task subagents to explore different areas of the repo in parallel, then merge the results into a single cohesive plan."
          : "\n\nDelegate exploration of different repo areas to sub-agents, then merge the results into a single cohesive plan.";
    }
    if (execBlock) prompt += `\n\n${execBlock}`;

    return prompt;
  }

  /**
   * The `follow`-mode planning directive (Phase 6's intended prompt delta —
   * the branch child-flow contract). Under every other knob this returns
   * null — non-follow prompts are byte-identical to the pre-Phase-6 text.
   * `auto_min_steps` does not exist as a knob: the ~N-branches consideration
   * is planner HINT text here, never a runtime threshold. Composed on the
   * TemplateComposer (Phase 5): skip-empty part semantics, no `join` array.
   */
  private executionDirective(ctx: FlowCtx): string | null {
    if (this.executionDefault(ctx) !== "follow") return null;
    return TemplateRenderer
      .compose("## Execution resolution — add these two top-level fields to your JSON response")
      .addLine("This flow's plan node is configured so YOU decide how the work executes after approval. Add exactly two top-level fields (everything else in the schema is unchanged):")
      .addBlankLine()
      .addLine('  "execution": "whole" or "steps"')
      .addLine('  "execution_rationale": "<one line — why>"')
      .addBlankLine()
      .addLines([
        `- "whole": the entire plan builds in ONE agent run (a tightly-coupled change, shared files, branches that depend on each other mid-task).`,
        `- "steps": each declared BRANCH becomes its own monitorable child flow on its own review unit (an approved plan of independent branches). A branch-less plan executes whole either way.`,
        `- Consider "steps" when the plan decomposes into roughly 5+ fairly independent branches a reviewer would want to verify one at a time. Sibling branch agents cannot see each other's code, so when you pick "steps" declare "dependsOn" between branches that share files — the scheduler starts a branch only after its dependencies resolve — and keep each branch's "files" accurate.`,
        `- Prefer "whole" for anything entangled — a wrong call trades review granularity for stuck siblings.`,
      ])
      .build();
  }

  /**
   * Scoped prompt (§2). Verbatim-prompt path composes as
   * `{{developerPromptBody}}` + the template's internal blocks (via
   * `assemblePrompt`) so the "Edit prompt" modal keeps working with
   * `promptIsBody`.
   */
  private buildScopedPrompt(
    ctx: FlowCtx,
    scoped: ScopedRefine,
    input: PlanInput,
    userRules: string,
  ): string {
    const vars = this.scopedVars(ctx, scoped, input);
    if (input.prompt) {
      if (!input.promptIsBody) return input.prompt;
      // feedback was typed into the modal body — keep the appended suffix's
      // feedback section blank so it isn't echoed twice
      return prompts.assemblePrompt("plan_subplan_refine", vars, { feedback: "" }, { body: input.prompt, userRules }).final;
    }
    return prompts.resolve("plan_subplan_refine", {}, vars, undefined, { userRules });
  }

  /** The scoped template's variables, built from the ref'd branch only (§2). */
  private scopedVars(
    ctx: FlowCtx,
    scoped: ScopedRefine,
    input: Pick<PlanInput, "feedback" | "contextBlocks">,
  ): Record<string, string> {
    const b = scoped.branch;
    const deps = scoped.latest.meta.branches.filter((d) => b.dependsOn.includes(d.name));
    return {
      branch: b.name,
      scope: b.scope || "(none stated)",
      files: b.files?.length ? b.files.join(", ") : "(none stated)",
      dependsOn: b.dependsOn.length ? b.dependsOn.join(", ") : "(none)",
      // what the sub-plan may assume exists — nothing else about other branches
      dependsOnSummaries: deps.length
        ? deps.map((d) => `- \`${d.name}\` (${d.title}): ${d.scope || "(no scope)"}`).join("\n")
        : "",
      subPlanPrompt: b.subPlan?.prompt || "(none yet — seed the sub-plan from the contract above)",
      currentSteps: this.currentStepsText(scoped.liveRows),
      feedback: input.feedback ?? "",
      context: this.assembleContext(ctx, input, scoped, { skipContract: true }),
    };
  }

  /** Compact current-steps list from LIVE checklist rows (hand edits included). */
  private currentStepsText(liveRows: PlanStepRow[]): string {
    if (!liveRows.length) return "(none yet)";
    return liveRows
      .map((r) => `- ${r.meta_id ?? r.id}: ${r.title}${r.detail ? ` — ${r.detail}` : ""} (${r.files?.length ?? 0} files)`)
      .join("\n");
  }

  // ── context block registry (§4) ───────────────────────────────────────────

  /** Resolve every block's rendered text (picker data + assembly source). */
  resolveContextBlocks(ctx: FlowCtx, scoped: ScopedRefine | null): ContextBlockInfo[] {
    const isScoped = Boolean(scoped);
    return CONTEXT_BLOCKS.map((spec) => {
      let text = "";
      switch (spec.id) {
        case "task":
          text = this.ctxHelper.taskContext(ctx);
          break;
        case "contract":
          text = scoped ? this.renderContract(scoped) : "";
          break;
        case "current":
          text = scoped ? this.renderCurrent(scoped) : "";
          break;
        case "branches":
          text = this.renderBranches(ctx, scoped);
          break;
        case "versions":
          text = this.renderVersions(ctx.flow.id);
          break;
        case "edits":
          text = isScoped ? "" : this.renderEdits(ctx.flow.id);
          break;
      }
      return {
        id: spec.id,
        label: spec.label,
        description: spec.description,
        text,
        chars: text.length,
        defaultOn: isScoped ? spec.scopedDefault : spec.wholeDefault,
        locked: Boolean(spec.pinned) && isScoped,
      };
    });
  }

  /**
   * Assemble {{context}} from the block registry — context is ALWAYS assembled
   * server-side (never trust client-assembled context, §7.5). Unknown ids are
   * dropped silently and logged at debug; the pinned `contract` block is always
   * included for scoped refines regardless of the client selection. An empty
   * selection falls back to the per-mode defaults (the minimal-context
   * recommendation).
   */
  private assembleContext(
    ctx: FlowCtx,
    input: Pick<PlanInput, "contextBlocks">,
    scoped: ScopedRefine | null,
    opts: { skipContract?: boolean; skip?: ContextBlockId[] } = {},
  ): string {
    const blocks = this.resolveContextBlocks(ctx, scoped);
    const selected = new Set(input.contextBlocks ?? []);
    const useDefaults = selected.size === 0;
    const byId = new Map<string, ContextBlockInfo>(blocks.map((b) => [b.id as string, b]));
    const skip = new Set(opts.skip ?? []);

    const unknown = [...selected].filter((id) => !byId.has(id));
    if (unknown.length) {
      console.debug(`[plan] dropped unknown context block ids: ${unknown.join(", ")}`);
    }

    const include = new Set<string>();
    for (const b of blocks) {
      if (skip.has(b.id)) continue;
      if (b.locked) include.add(b.id); // pinned: `contract` for scoped refines
      else if (useDefaults ? b.defaultOn : selected.has(b.id)) include.add(b.id);
    }
    if (opts.skipContract) {
      // The contract is template-pinned (renders via {{scope}}/{{files}}/
      // {{dependsOn}}/{{dependsOnSummaries}}) — never duplicate it into
      // {{context}}. Its char count is still reported to the picker.
      include.delete("contract");
    }

    return CONTEXT_BLOCK_ORDER.flatMap((id) => {
      if (!include.has(id)) return [];
      const b = byId.get(id);
      return b && b.text.length > 0 ? [`## ${b.label}\n${b.text}`] : [];
    })
      .join("\n\n");
  }

  /** Branch contract text — scope, files, and what the sub-plan may assume exists. */
  private renderContract(scoped: ScopedRefine): string {
    const b = scoped.branch;
    const deps = scoped.latest.meta.branches.filter((d) => b.dependsOn.includes(d.name));
    return [
      `- scope: ${b.scope || "(none stated)"}`,
      `- files: ${b.files?.length ? b.files.join(", ") : "(none stated)"}`,
      `- depends on: ${b.dependsOn.length ? b.dependsOn.join(", ") : "(none)"}`,
      deps.length ? deps.map((d) => `- \`${d.name}\` (${d.title}): ${d.scope || "(no scope)"}`).join("\n") : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  /** Current sub-plan block: prompt + live checklist rows (hand edits included). */
  private renderCurrent(scoped: ScopedRefine): string {
    const prompt = scoped.branch.subPlan?.prompt
      ? `"""\n${scoped.branch.subPlan.prompt}\n"""`
      : "(none yet)";
    return `Sub-plan prompt:\n${prompt}\n\nCurrent steps:\n${this.currentStepsText(scoped.liveRows)}`;
  }

  /** Sibling branches as title + scope summaries only. */
  private renderBranches(ctx: FlowCtx, scoped: ScopedRefine | null): string {
    const branches = this.latestPlan(ctx.flow.id)?.meta.branches ?? [];
    const others = scoped ? branches.filter((b) => b.name !== scoped.branch.name) : branches;
    if (!others.length) return "";
    return others.map((b) => `- \`${b.name}\` (${b.title}): ${b.scope || "(no scope)"}`).join("\n");
  }

  /** Previous plan versions — off by default for both modes (dead code kept reachable via the picker). */
  private renderVersions(flowId: string): string {
    const artifacts = this.support
      .artifactsOfKind(flowId, "plan", { limit: 3 })
      .map((a) => ({ content: a.content, version: a.version }));
    if (!artifacts.length) return "";
    return artifacts
      .map((a) => `--- plan v${a.version} ---\n${a.content.slice(0, 3000)}`)
      .join("\n\n");
  }

  /** The developer's live hand edits — whole-plan refines only (§4). */
  private renderEdits(flowId: string): string {
    const all = this.liveRows(flowId);
    if (!all.length) return "";
    return (
      "The developer already adjusted the plan checklist like this — treat these as intent and " +
      "preserve them unless the feedback changes them:\n" +
      all
        .map((r) =>
          `- ${r.meta_id ?? r.id}: ${r.title}${r.detail ? ` — ${r.detail}` : ""}${r.branch ? ` (branch: ${r.branch})` : ""}`
        )
        .join("\n")
    );
  }

  /** Live checklist rows (validated) — hand edits included by construction. */
  private liveRows(flowId: string): PlanStepRow[] {
    return rows.all(PlanStepRow, `SELECT * FROM plan_steps WHERE flow_id=? ORDER BY position, created_at`, flowId);
  }

  /**
   * Latest plan artifact + parsed meta. All scoped variables come from THIS
   * artifact's meta, never from other versions (§2).
   */
  private latestPlan(flowId: string): {
    art: { id: string; version: number; content: string };
    meta: PlanMeta;
    rawMeta: Record<string, unknown>;
  } | null {
    const row = this.support.latestArtifact(flowId, "plan");
    if (!row) return null;
    let meta: PlanMeta = { steps: [], branches: [] };
    let rawMeta: Record<string, unknown> = {};
    try {
      const m = row.meta ? JSON.parse(row.meta) : null;
      if (m && typeof m === "object") {
        rawMeta = m;
        if (Array.isArray(m.steps) && m.steps.length) {
          meta = {
            steps: m.steps as PlanStep[],
            branches: Array.isArray(m.branches) ? (m.branches as PlanMeta["branches"]) : [],
          };
        }
      }
    } catch {
      /* unparseable meta → treated as a branchless plan; scoped refine falls back */
    }
    return { art: { id: row.id, version: row.version, content: row.content }, meta, rawMeta };
  }

  // ── plan-domain persistence ────────────────────────────────────────────────

  /**
   * The planner's execution decision out of a parsed plan response (Phase 3B,
   * `execution_default: follow`): `execution` + `execution_rationale` are
   * OPTIONAL top-level response fields — unknown/missing values normalize to
   * `whole` with no rationale, and nothing here can fail the plan (the parse
   * pipeline is not extended with a requirement).
   */
  private normalizePlannerExecution(
    whole: { execution?: unknown; execution_rationale?: unknown } | null | undefined,
  ): { value: "whole" | "steps"; rationale: string | null } {
    if (whole?.execution === "steps") {
      const r = typeof whole.execution_rationale === "string" && whole.execution_rationale.trim()
        ? whole.execution_rationale.trim().slice(0, 280)
        : null;
      return { value: "steps", rationale: r };
    }
    const r = typeof whole?.execution_rationale === "string" && whole.execution_rationale.trim()
      ? whole.execution_rationale.trim().slice(0, 280)
      : null;
    return { value: "whole", rationale: r };
  }

  /** Save the plan artifact and sync the editable step checklist from it. */
  private persistPlan(
    ctx: FlowCtx,
    node: NodeRow,
    input: PlanInput,
    text: string,
    planMeta: PlanMeta | null,
    plannerExecution?: { value: "whole" | "steps"; rationale: string | null },
  ) {
    // plan fan-out (§1 "who decides the mode"): the published execution
    // resolution rides every plan version in artifacts.meta (`execution`) —
    // precedence: the knob (whole/steps) > the planner's follow value > whole.
    // Sources (auditable per version): "knob" (explicit planning knob),
    // "planner" (follow + the planner decided this version), "default"
    // (follow + the planner published nothing valid ⇒ whole). Re-refining
    // re-publishes; the approve-time override (approve_plan action) writes
    // executionSource "override" into the same meta afterwards.
    const knob = this.executionDefault(ctx);
    let execution: "whole" | "steps" = "whole";
    let source: "knob" | "planner" | "default" = "knob";
    let rationale: string | undefined;
    if (knob === "follow") {
      execution = plannerExecution?.value ?? "whole";
      source = plannerExecution ? "planner" : "default";
      rationale = plannerExecution?.rationale ?? undefined;
    } else {
      execution = knob;
      source = "knob";
    }
    const art = this.support.saveArtifact(node.id, ctx.flow.id, "plan", text, {
      feedback: input.feedback,
      branches: planMeta?.branches ?? undefined,
      steps: planMeta?.steps ?? undefined,
      execution,
      executionSource: source,
      ...(rationale ? { execution_rationale: rationale } : {}),
    });

    const stepCount = planMeta?.steps?.length
      ? planSteps.syncFromPlan(ctx.flow.id, art.id, planMeta.steps)
      : 0;

    return { art, stepCount };
  }

  /**
   * The plan node's `execution_default` knob (class ← app ← flow snapshot).
   * The knob domain is whole|follow now, but LEGACY configs may still carry
   * "steps" (the retired per-step child flows): old per-step intent maps to
   * the per-branch fan-out, so it surfaces as "steps" here and
   * splitResolution resolves it per-unit. Anything else → "whole".
   */
  private executionDefault(ctx: FlowCtx): "whole" | "steps" | "follow" {
    const raw = this.nodeConfig(ctx)["execution_default"];
    return raw === "steps" || raw === "follow" ? raw : "whole";
  }

  // ── split source port (agent-node split plan §2.1) — the plan's branches ──

  /**
   * The plan's branches as split units (Phase 6): one unit per declared
   * branch, scheduled purely by the branch DAG. The unit's item carries the
   * branch contract plus the full plan document (`plan`) so the child build
   * run gets its complete context — the same input build's own multi-branch
   * triggerRuns decomposition passes. Null when there is no plan artifact
   * or no branches (the consumer then runs whole).
   */
  override splitUnits(ctx: FlowCtx): SplitUnit[] | null {
    const latest = this.latestPlan(ctx.flow.id);
    if (!latest || !latest.meta.branches.length) return null;
    return latest.meta.branches.map((b) => ({
      key: b.name,
      title: b.title,
      dependsOn: [...b.dependsOn],
      target: "build",
      item: {
        name: b.name,
        title: b.title,
        scope: b.scope,
        files: b.files,
        dependsOn: b.dependsOn,
        subPlan: b.subPlan ?? null,
        markdown: b.markdown ?? null,
        plan: latest.art.content,
      },
    }));
  }

  /**
   * The published resolution recommendation (§2.4), honored by consumers
   * whose `split_consume` knob is "source": knob whole → whole; the legacy
   * knob "steps" → per-unit (old per-step intent = per-branch fan-out);
   * follow → the published plan-version meta decides (execution "steps" ⇒
   * per-unit, anything else whole). Total: a missing/unparseable plan
   * artifact resolves whole — never throws.
   */
  override splitResolution(ctx: FlowCtx): "whole" | "per-unit" | null {
    const knob = this.executionDefault(ctx);
    if (knob === "steps") return "per-unit"; // legacy per-step config
    if (knob === "follow") {
      const published = this.latestPlan(ctx.flow.id)?.rawMeta.execution;
      return published === "steps" ? "per-unit" : "whole";
    }
    return "whole";
  }

  /** Custom sub-agents for decompose mode (cloud runs only). */
  private decomposeSubagents(ctx: FlowCtx, input: PlanInput) {
    return input.decompose && this.ctxHelper.execMode(ctx) === "cloud"
      ? [{ name: "repo-explorer", instructions: "Explore the repository structure, identify key modules, and report back on architecture and dependencies." }]
      : undefined;
  }

  async recover(
    ctx: FlowCtx,
    node: NodeRow,
    result: AgentRunResult,
    note: string,
  ): Promise<boolean> {
    // Scoped recovery is skipped: recover() can't distinguish a scoped
    // response from a whole-plan one, and a replayed scoped run must not be
    // silently merged. Decline so the node fails → the developer retries (the
    // retry stays scoped and re-enters the normal flow).
    try {
      const recorded = this.inputSchema.parse(node.input ?? {});
      if (recorded.branchRef) return false;
    } catch {
      /* unparseable input → fall through to whole-plan recovery */
    }

    if (result.status !== "finished") return false;

    // The same contract a live finish passes: an unparseable or contract-
    // violating recorded result is not recoverable — the node fails for a
    // manual retry (the standard agent-node recovery posture).
    let plan: PlanResponse;
    try {
      plan = this.parsePlanResponse(result.result ?? "", PlanResponse);
    } catch {
      return false;
    }

    const planMeta: PlanMeta = { steps: withStepIds(plan.steps), branches: plan.branches ?? [] };

    // recovery keeps the plan version's published execution too (Phase 3B): a
    // recovered response's planner decision rides the artifact meta so the
    // plan panel/chips and from-plan fan-out gates see the same resolution
    const recoveredExec = this.normalizePlannerExecution(plan);
    const art = this.support.saveArtifact(node.id, ctx.flow.id, "plan", plan.markdown, {
      recovered: true,
      execution: recoveredExec.value,
      executionSource: recoveredExec.rationale ? "planner" : "default",
      ...(recoveredExec.rationale ? { execution_rationale: recoveredExec.rationale } : {}),
    });
    const stepCount = planMeta.steps.length
      ? planSteps.syncFromPlan(ctx.flow.id, art.id, planMeta.steps)
      : 0;

    this.applyOutcome(ctx, this.planOutcome(art, planMeta, stepCount, plan.markdown), {
      note: `recovered: ${note}`,
    });
    return true;
  }

  // ── prompt previews (used by the prompt route) ────────────────────────────

  /**
   * Live prompt preview (verbatim from the route's former plan case): the
   * feedback-refine preview renders the plan_refine template when a feedback
   * text is given on a node with an agent to refine on; otherwise the plan
   * body (config knob or default) with the ticket vars.
   */
  previewPrompt(ctx: FlowCtx, node: NodeRow | null, params: PromptPreviewParams): NodePromptPreview | null {
    if (params.feedback && node?.agent_id) {
      // feedback refine preview (follow-up on the plan agent): the full
      // body-only refine template with the feedback rendered in. The context
      // block is run data — assembled at run time (assembleContext).
      const asm = prompts.assemblePrompt(
        "plan_refine",
        { ticket: this.ctxHelper.taskContext(ctx) },
        { feedback: params.feedback },
        { userRules: nodeRoles.previewRules(this, node) },
      );
      return { templateKey: "plan_refine", configBody: null, assembly: asm };
    }
    const configBody = nodeRoles.previewBody(this, node);
    const asm = prompts.assemblePrompt(
      NODE_KEYS.PLAN,
      { ticket: this.ctxHelper.taskContext(ctx), ticket_type: this.ctxHelper.taskLabel(ctx) },
      undefined,
      { body: configBody, userRules: nodeRoles.previewRules(this, node) },
    );
    return { templateKey: NODE_KEYS.PLAN, configBody, assembly: asm };
  }

  /**
   * Branch-scoped prompt preview for the prompt route (§7.2): the
   * developer-editable body ({{feedback}} blank — the developer types it) plus
   * the context block list so the PromptModal can render the picker.
   * Returns null when the branch is unknown (the route surfaces a 400).
   */
  previewSubPlanPrompt(
    ctx: FlowCtx,
    branchName: string,
    contextBlocks?: string[],
  ): { prompt: string; contextBlocks: ContextBlockInfo[]; appendsInternal: true } & PromptSectionsLike | null {
    const scoped = this.prepareScopedRefine(ctx, { branchRef: branchName });
    if (!scoped) return null;
    const blocks = this.resolveContextBlocks(ctx, scoped);
    const vars = this.scopedVars(ctx, scoped, { feedback: "", contextBlocks: contextBlocks ?? [] });
    const asm = prompts.assemblePrompt(
      "plan_subplan_refine", vars, { feedback: "" },
      { userRules: configString(this.nodeConfig(ctx), "prompt_rules") },
    );
    return { prompt: asm.body, contextBlocks: blocks, appendsInternal: true, ...sectionsOf(asm) };
  }
}

/** Everything {@link PlanNode.prepareScopedRefine} resolved, or null for the
 *  whole-plan path. Declared after the class (type position only). */
type ScopedRefine = NonNullable<ReturnType<PlanNode["prepareScopedRefine"]>>;
