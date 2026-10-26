import { db } from "../../../db";
import { z } from "zod";
import type { AgentRunResult } from "../../ports/agent-runner";
import { PlanStepRow, rows, type NodeRow } from "../../../db/rows";
import { prompts } from "../../prompts";
import { planSteps } from "../../steps";
import { NodeDefinition, type FlowCtx, type RunOutcome } from "../base";
import type { NodeCapabilities } from "../base/capabilities";
import { NODE_KEYS } from "../keys";
import type { ConfigField } from "../../node-config";
import { appLayerConfig, mergeConfigLayers, mcpSourcesOf, mcpSourcesSchema, mcpSourceConfigFields, parseConfigSnapshot, type SettingSource } from "../../node-config";
import { PlanMetaParser, type PlanParseResult } from "./plan-meta-parser";
import {
  PlanInput,
  PlanOutput,
  type PlanBranch,
  type PlanMeta,
  type PlanStep,
  type PlanValidationError,
  type SimplePlanResponse,
  type ComplexPlanResponse,
  type SubPlanResponse,
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

// ── per-mode parse config for generatePlan (§3) ──────────────────────────────

interface ParseModeConfig<T> {
  /** how to parse + validate the agent's JSON response */
  parse: (text: string) => PlanParseResult<T>;
  /** the schema hint included in the retry prompt */
  schemaHint: string;
  /** requirement lines for the retry prompt */
  requirements: string[];
  /** what the retry asks the agent to re-emit */
  retrySubject: string;
}

const WHOLE_PLAN_SCHEMA_HINT =
  `{"markdown":"<plan markdown>","steps":[{"id","title","detail","files","branch"}],"branches":[{"name","title","scope","files","steps","dependsOn","subPlan"}]}`;
const SUB_PLAN_SCHEMA_HINT =
  `{"markdown":"<this branch's sub-plan>","steps":[{"id","title","detail","files"}]}`;

const WHOLE_PLAN_REQUIREMENTS = [
  `- "markdown" (string, non-empty): the full plan in Markdown`,
  `- "steps" (array, min 1): each with unique short "id" (s1, s2, …), non-empty "title", "detail", "files" array, "branch" (null or valid branch name)`,
  `- "branches" (optional array): each with unique lowercase-hyphen "name", "title", "scope", "files", "steps", "dependsOn" (valid branch names), optional "subPlan"`,
  `- step "branch" must be null or match a declared branch "name"`,
];

/**
 * Scoped requirement lines mirror the scoped template: replace ONLY this
 * branch — never re-emit the full plan or other branches' steps.
 */
const SUB_PLAN_REQUIREMENTS = [
  `- replace ONLY this branch's sub-plan — never re-emit the full plan or other branches' steps`,
  `- "markdown" (string, non-empty): this branch's implementation detail in Markdown`,
  `- "steps" (array, min 1): each with unique short "id" (s1, s2, …), non-empty "title", "detail", "files" array`,
];

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
  const byId = (arr: PlanStep[]) => new Map(arr.filter((s) => s.id).map((s) => [s.id!, s]));
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
  const leftoversOld = [...oldById.values()].filter((s) => !newById.has(s.id!));
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

export class PlanNode extends NodeDefinition<PlanInput, PlanOutput> {
  readonly key = NODE_KEYS.PLAN;
  readonly label = "Plan";
  readonly promptKeys = ["plan", "plan_refine", "plan_complex", "plan_complex_refine", "plan_subplan_refine"] as const;
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

  readonly inputSchema = PlanInput;
  readonly outputSchema = PlanOutput;

  private readonly parser = new PlanMetaParser();

  /** Typed config knobs (defaults = today's behavior). */
  readonly configSchema = z.object({
    /** user-editable prompt body (foldable per template/flow; the global overlay was removed) */
    prompt_body: z.string().optional(),
    /** default for whole-flow starts that don't pass `complex` explicitly */
    default_complex: z.boolean().default(false),
    /** default for starts that don't pass `decompose` explicitly */
    decompose_default: z.boolean().default(false),
    /**
     * Plan fan-out (§1 "who decides the mode"): the published execution
     * resolution. `follow` = the PLANNER decides per plan version — the
     * plan prompt gains the execution directive and the response's
     * `execution` + `execution_rationale` are published in plan-meta
     * (unknown/missing ⇒ whole, never a parse failure). An explicit
     * whole/steps beats the follow value; the published value rides every
     * plan version in `artifacts.meta.execution` (source: knob | planner |
     * default | override), and the plan panel offers the override at approve.
     */
    execution_default: z.enum(["whole", "steps", "follow"]).default("whole"),
    /** ambient MCP servers for plan agent runs (Cursor local.settingSources) */
    mcp_sources: mcpSourcesSchema,
  });
  readonly configFields = [
    { key: "prompt_body", label: "Prompt body", type: "text", help: "User-editable prompt body; internal output contracts are appended automatically." },
    { key: "default_complex", label: "Default to complex plans", type: "boolean", help: "Used when a start doesn't request a mode explicitly." },
    { key: "decompose_default", label: "Decompose by default", type: "boolean", help: "Run repo-exploration sub-agents by default." },
    {
      key: "execution_default", label: "Execution resolution", type: "select",
      help:
        "How the checklist executes after this plan is approved: whole (one run — today), steps "
        + "(one child sub-flow per plan step — downstream fan-out nodes honor it), follow (the planner decides per plan version and publishes the choice with a one-line rationale; you can override it at approve).",
      options: [
        { value: "whole", label: "whole", description: "Everything executes as one run (default)" },
        { value: "steps", label: "steps", description: "Step-by-step: fan-out nodes spawn one child flow per step" },
        { value: "follow", label: "follow", description: "The planner decides per plan version (published in plan-meta, overridable at approve)" },
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
    const node = this.node(ctx);
    this.support.setNode(node.id, { status: "running" });

    // Branch-scoped path (§2/§3): refine ONE branch's sub-plan.
    const scoped = input.branchRef ? this.prepareScopedRefine(ctx, input) : null;
    if (input.branchRef && !scoped) {
      // Edge case (§9): branchRef on a simple plan or unknown branch name →
      // fall back to a whole-plan refine with a lifecycle note, never hard-fail.
      db.emitEvent(
        ctx.flow.id, node.id, "lifecycle",
        `branch "${input.branchRef}" not found in the current plan — refining the whole plan instead`,
      );
    }

    const prompt = scoped ? this.buildScopedPrompt(ctx, scoped, input) : this.buildPlanPrompt(ctx, node, input);
    const customSubagents = this.decomposeSubagents(ctx, input);
    const settingSources = mcpSourcesOf(config);
    this.recordInput(node.id, { ...input, prompt }, input.prompt);

    if (scoped) return this.runScoped(ctx, node, input, scoped, prompt, customSubagents, settingSources);

    // ── whole-plan path (prior behavior, context now registry-assembled) ────
    const runOnce = (p: string, label: string, followUp: string | null) =>
      this.runAgent(ctx, node.id, input, customSubagents, settingSources, p, label, followUp);

    const isComplex = input.complex;
    const label = isComplex ? "complex plan" : "plan";
    const refineLabel = isComplex ? "complex plan refine" : "plan refine";
    const hasAgent = Boolean(node.agent_id);

    // Whole-plan refine follows up by default (the conversation holds the
    // decomposition rationale); `fresh` is the quality escape hatch (§3).
    const initialFollowUp =
      input.fresh === true ? null : input.feedback && hasAgent ? node.agent_id : null;

    const { data, markdown, validationErrors } = await this.generatePlan(ctx, node, {
      prompt,
      runOnce,
      mode: this.planMode(isComplex),
      firstRunLabel: input.feedback && hasAgent ? refineLabel : label,
      initialFollowUp,
      label,
    });

    const whole = data as ComplexPlanResponse | SimplePlanResponse | null;
    const planMeta: PlanMeta | null = whole
      ? isComplex
        ? { steps: whole.steps, branches: (whole as ComplexPlanResponse).branches ?? [] }
        : { steps: whole.steps, branches: [] }
      : null;

    const { art, stepCount } = this.persistPlan(ctx, node, input, markdown, planMeta,
      this.normalizePlannerExecution(whole));
    return this.finalizePlan(ctx, node, art, planMeta, stepCount, markdown, validationErrors, isComplex);
  }

  // ── scoped refine run (Phase A) ───────────────────────────────────────────

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

  /**
   * The scoped run: prompt → parse SubPlanResponse → deterministic merge →
   * new artifact version (plan markdown unchanged) → scoped checklist sync.
   * Validation retries once, scoped.
   */
  private async runScoped(
    ctx: FlowCtx,
    node: NodeRow,
    input: PlanInput,
    scoped: NonNullable<ReturnType<PlanNode["prepareScopedRefine"]>>,
    prompt: string,
    customSubagents: ReturnType<PlanNode["decomposeSubagents"]>,
    settingSources: SettingSource[],
  ): Promise<RunOutcome> {
    const branchName = scoped.branch.name;
    // Fresh by default (§3): the scoped template is self-contained; a follow-up
    // saves only bounded repo re-exploration but biases the model toward its
    // earlier decisions.
    const fresh = input.fresh ?? true;
    const runOnce = (p: string, label: string, followUp: string | null) =>
      this.runAgent(ctx, node.id, input, customSubagents, settingSources, p, label, followUp);
    const initialFollowUp = fresh ? null : node.agent_id ?? null;
    const refineLabel = `sub-plan refine (${branchName}${fresh ? ", fresh" : ""})`;

    const { data, markdown, validationErrors } = await this.generatePlan(ctx, node, {
      prompt,
      runOnce,
      mode: this.subPlanMode(),
      firstRunLabel: refineLabel,
      initialFollowUp,
      label: refineLabel,
    });

    if (!data) {
      // Scoped validation failure (§9): keep the previous artifact version;
      // node failed with validationErrors. Recovery for scoped runs is skipped
      // (§3) — the developer retries, and the retry stays scoped.
      const output = this.outputSchema.parse({
        latestArtifact: scoped.latest.art.id,
        version: scoped.latest.art.version,
        branches: scoped.latest.meta.branches,
        steps: scoped.latest.meta.steps,
        complex: true,
        malformed: true,
        validationErrors,
      });
      this.support.setNode(node.id, {
        status: "failed",
        agent_id: this.support.lastAgentId(node.id),
        output: JSON.stringify(output),
      });
      const event =
        `branch "${branchName}" sub-plan was malformed after retry — plan v${scoped.latest.art.version} kept, retry when ready`;
      db.emitEvent(ctx.flow.id, node.id, "lifecycle", event);
      return { status: "failed", output, event, reply: markdown || "(malformed sub-plan response)" };
    }

    // Deterministic merge: everything outside this branch stays byte-identical.
    const merged = mergeBranchRefine(scoped.latest.meta, branchName, data);
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
    const { added, removed, changed } = diffBranchSteps(oldSteps, data.steps);
    const diffNote = `(+${added.length} / −${removed.length}${changed.length ? `, ${changed.length} changed` : ""})`;

    const output = this.outputSchema.parse({
      latestArtifact: art.id,
      version: art.version,
      branches: merged.branches,
      steps: merged.steps,
      complex: true,
      scopedRefine: { branch: branchName, from: scoped.latest.art.version },
    });
    this.support.setNode(node.id, {
      status: "awaiting_approval",
      agent_id: this.support.lastAgentId(node.id),
      output: JSON.stringify(output),
    });

    const event =
      `branch '${branchName}' sub-plan refined · ${stepCount} steps ${diffNote} — other branches untouched`;
    db.emitEvent(ctx.flow.id, node.id, "lifecycle", event);

    return { status: "awaiting_approval", output, event, reply: data.markdown };
  }

  // ── prompts ────────────────────────────────────────────────────────────────

  /** Whole-plan prompt: verbatim override, refine template, or base + feedback. */
  private buildPlanPrompt(ctx: FlowCtx, node: NodeRow, input: PlanInput): string {
    const hasAgent = Boolean(node.agent_id);
    const baseCtx = { ticket: this.ctxHelper.taskContext(ctx), ticket_type: this.ctxHelper.taskLabel(ctx) };
    const refining = Boolean(input.feedback) || Boolean(input.prompt);
    const contextBlock = this.assembleContext(ctx, input, null, {
      // the base template already renders {{ticket}} — a task context block
      // earns its place only on refinement prompts (+ branch refines)
      skip: refining ? [] : ["task"],
    });
    const tplKey = input.complex ? "plan_complex" : "plan";
    const refineKey = input.complex ? "plan_complex_refine" : "plan_refine";
    // Phase 3B (`execution_default: follow`): the planner decides how the
    // checklist executes. The directive is an APPENDED block — the default
    // templates (and every non-follow prompt) stay byte-for-byte; the block
    // rides the base/refine/promptIsBody paths so an "Edit prompt" run keeps
    // the output contract. The raw verbatim-prompt path is untouched
    // (feedback-echo refines skip it by definition).
    const execBlock = this.executionDirective(ctx.flow.id);

    if (input.prompt) {
      return input.promptIsBody
        ? `${input.prompt}\n\n${prompts.internalSuffix(tplKey, baseCtx, { context: contextBlock })}${execBlock ? `\n\n${execBlock}` : ""}`
        : input.prompt;
    }
    if (input.feedback && hasAgent) {
      const refined = prompts.resolve(refineKey, baseCtx, { feedback: input.feedback, context: contextBlock });
      return execBlock ? `${refined}\n\n${execBlock}` : refined;
    }
    const base = prompts.resolve(tplKey, baseCtx, { context: contextBlock });
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
   * The `follow`-mode planning directive (Phase 3B). Under every other knob
   * this returns null — non-follow prompts are byte-identical to Phase 1.
   * `auto_min_steps` does not exist as a knob: the ~N-steps consideration is
   * planner HINT text here, never a runtime threshold.
   */
  private executionDirective(flowId: string): string | null {
    if (this.executionDefault(flowId) !== "follow") return null;
    return [
      `## Execution resolution — add these two top-level fields to your JSON response`,
      `This flow's plan node is configured so YOU decide how the checklist executes after approval. Add exactly two top-level fields (everything else in the schema is unchanged):`,
      ``,
      `  "execution": "whole" or "steps"`,
      `  "execution_rationale": "<one line — why>"`,
      ``,
      `- "whole": the entire plan builds in ONE agent run (a tightly-coupled change, shared files, steps that depend on each other mid-task).`,
      `- "steps": each checklist step runs as its own monitorable sub-flow on its own review unit (an approved plan of independent, file-disjoint work).`,
      `- Consider "steps" when the plan decomposes into roughly 5+ fairly independent steps a reviewer would want to verify one at a time. Sibling step agents cannot see each other's code, so when you pick "steps" keep each step's "files" accurate and disjoint from other steps.`,
      `- Prefer "whole" for anything entangled — a wrong call trades review granularity for stuck siblings.`,
    ].join("\n");
  }

  /**
   * Scoped prompt (§2). Verbatim-prompt path composes as
   * `{{developerPromptBody}} + internalSuffix("plan_subplan_refine", …)` so the
   * "Edit prompt" modal keeps working with `promptIsBody`.
   */
  private buildScopedPrompt(
    ctx: FlowCtx,
    scoped: NonNullable<ReturnType<PlanNode["prepareScopedRefine"]>>,
    input: PlanInput,
  ): string {
    const vars = this.scopedVars(ctx, scoped, input);
    if (input.prompt) {
      if (!input.promptIsBody) return input.prompt;
      // feedback was typed into the modal body — keep the appended suffix's
      // feedback section blank so it isn't echoed twice
      return `${input.prompt}\n\n${prompts.internalSuffix("plan_subplan_refine", vars, { feedback: "" })}`;
    }
    return prompts.resolve("plan_subplan_refine", {}, vars);
  }

  /** The scoped template's variables, built from the ref'd branch only (§2). */
  private scopedVars(
    ctx: FlowCtx,
    scoped: NonNullable<ReturnType<PlanNode["prepareScopedRefine"]>>,
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
  resolveContextBlocks(ctx: FlowCtx, scoped: ReturnType<PlanNode["prepareScopedRefine"]>): ContextBlockInfo[] {
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
    scoped: ReturnType<PlanNode["prepareScopedRefine"]>,
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

    return CONTEXT_BLOCK_ORDER.filter((id) => include.has(id) && (byId.get(id)?.text.length ?? 0) > 0)
      .map((id) => {
        const b = byId.get(id)!;
        return `## ${b.label}\n${b.text}`;
      })
      .join("\n\n");
  }

  /** Branch contract text — scope, files, and what the sub-plan may assume exists. */
  private renderContract(scoped: NonNullable<ReturnType<PlanNode["prepareScopedRefine"]>>): string {
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
  private renderCurrent(scoped: NonNullable<ReturnType<PlanNode["prepareScopedRefine"]>>): string {
    const prompt = scoped.branch.subPlan?.prompt
      ? `"""\n${scoped.branch.subPlan.prompt}\n"""`
      : "(none yet)";
    return `Sub-plan prompt:\n${prompt}\n\nCurrent steps:\n${this.currentStepsText(scoped.liveRows)}`;
  }

  /** Sibling branches as title + scope summaries only. */
  private renderBranches(ctx: FlowCtx, scoped: ReturnType<PlanNode["prepareScopedRefine"]>): string {
    const branches = this.latestPlan(ctx.flow.id)?.meta.branches ?? [];
    const others = scoped ? branches.filter((b) => b.name !== scoped.branch.name) : branches;
    if (!others.length) return "";
    return others.map((b) => `- \`${b.name}\` (${b.title}): ${b.scope || "(no scope)"}`).join("\n");
  }

  /** Previous plan versions — off by default for both modes (dead code kept reachable via the picker). */
  private renderVersions(flowId: string): string {
    const artifacts = db.all<{ content: string; version: number }>(
      `SELECT a.content, a.version FROM artifacts a JOIN nodes n ON n.id = a.node_id
       WHERE n.flow_id = ? AND a.kind = 'plan' ORDER BY a.version DESC LIMIT 3`,
      flowId,
    );
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
    const row = db.get<{ id: string; version: number; content: string; meta: string | null }>(
      `SELECT a.id, a.version, a.content, a.meta FROM artifacts a JOIN nodes n ON n.id = a.node_id
       WHERE n.flow_id = ? AND a.kind = 'plan' ORDER BY a.version DESC LIMIT 1`,
      flowId,
    );
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
            branches: Array.isArray(m.branches) ? (m.branches as PlanBranch[]) : [],
          };
        }
      }
    } catch {
      /* unparseable meta → treated as a simple plan; scoped refine falls back */
    }
    return { art: { id: row.id, version: row.version, content: row.content }, meta, rawMeta };
  }

  // ── whole-plan machinery (prior behavior) ─────────────────────────────────

  /** Parse mode for whole plan runs: simple vs complex JSON response. */
  private planMode(isComplex: boolean): ParseModeConfig<ComplexPlanResponse | SimplePlanResponse> {
    return {
      parse: (text) => (isComplex ? this.parser.parseComplex(text) : this.parser.parseSimple(text)),
      schemaHint: WHOLE_PLAN_SCHEMA_HINT,
      requirements: WHOLE_PLAN_REQUIREMENTS,
      retrySubject: "Re-emit the FULL plan",
    };
  }

  /** Scoped parse mode — a scoped retry must stay scoped. */
  private subPlanMode(): ParseModeConfig<SubPlanResponse> {
    return {
      parse: (text) => this.parser.parseSubPlan(text),
      schemaHint: SUB_PLAN_SCHEMA_HINT,
      requirements: SUB_PLAN_REQUIREMENTS,
      retrySubject: "Re-emit ONLY your sub-plan response",
    };
  }

  /** Custom sub-agents for decompose mode (cloud runs only). */
  private decomposeSubagents(ctx: FlowCtx, input: PlanInput) {
    return input.decompose && this.ctxHelper.execMode(ctx) === "cloud"
      ? [{ name: "repo-explorer", instructions: "Explore the repository structure, identify key modules, and report back on architecture and dependencies." }]
      : undefined;
  }

  /** Execute a single plan-mode agent run. */
  private runAgent(
    ctx: FlowCtx,
    nodeId: string,
    input: PlanInput,
    customSubagents: ReturnType<PlanNode["decomposeSubagents"]>,
    settingSources: SettingSource[],
    prompt: string,
    label: string,
    followUp: string | null,
  ) {
    return this.runner.executeRun(
      ctx,
      nodeId,
      () =>
        this.runner.startAgent(ctx, {
          prompt,
          mode: "plan",
          name: `${label} ${ctx.task.key}`,
          followUpOn: followUp,
          customSubagents,
          model: input.model,
          settingSources,
        }),
      label,
    );
  }

  /**
   * Run the plan agent and parse the JSON response (per-mode parse config).
   * Retries once on validation failure with specific error feedback. The retry
   * stays on the same agent (lastAgentId) and stays in the same mode — a
   * scoped retry never re-emits the full plan.
   */
  private async generatePlan<T>(
    ctx: FlowCtx,
    node: NodeRow,
    opts: {
      prompt: string;
      runOnce: (p: string, label: string, followUp: string | null) => Promise<AgentRunResult>;
      mode: ParseModeConfig<T>;
      firstRunLabel: string;
      initialFollowUp: string | null;
      label: string;
    },
  ): Promise<{ data: T | null; markdown: string; validationErrors: PlanValidationError[] }> {
    const { runOnce, mode } = opts;
    let result = await runOnce(opts.prompt, opts.firstRunLabel, opts.initialFollowUp);
    let text = result.result ?? "";
    let parsed = mode.parse(text);

    if (!parsed.data) {
      // Retry once with error feedback
      const errorList = parsed.errors.map((e) => `  - ${e.path ? `${e.path}: ` : ""}${e.message}`).join("\n");
      db.emitEvent(
        ctx.flow.id, node.id, "lifecycle",
        `${opts.label} validation failed — retrying with feedback (${parsed.errors.length} error${parsed.errors.length > 1 ? "s" : ""})`,
      );

      const retryPrompt = [
        `Your previous response was not valid JSON or failed schema validation:`,
        ``,
        errorList,
        ``,
        `${mode.retrySubject} as a single JSON object matching this schema:`,
        mode.schemaHint,
        ``,
        `Requirements:`,
        `- your entire response must be parseable as a single JSON object — no prose, no code fences`,
        ...mode.requirements,
      ].join("\n");

      result = await runOnce(retryPrompt, `${opts.label} retry`, this.support.lastAgentId(node.id));
      text = result.result ?? "";
      parsed = mode.parse(text);
    }

    return {
      data: parsed.data,
      markdown: parsed.data ? (parsed.data as unknown as { markdown: string }).markdown : text,
      validationErrors: parsed.errors,
    };
  }

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
    const knob = this.executionDefault(ctx.flow.id);
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

  /** The plan node's `execution_default` knob (class ← app ← flow snapshot). */
  private executionDefault(flowId: string): "whole" | "steps" | "follow" {
    const raw = mergeConfigLayers(
      this.defaultConfig(),
      appLayerConfig(this.key),
      parseConfigSnapshot(db.get<{ config: string | null }>(
        `SELECT config FROM nodes WHERE flow_id=? AND type=?`, flowId, NODE_KEYS.PLAN
      )?.config ?? null),
    )["execution_default"];
    return raw === "steps" || raw === "follow" ? raw : "whole";
  }

  /** Persist output/status, emit the lifecycle event, and build the outcome. */
  private finalizePlan(
    ctx: FlowCtx,
    node: NodeRow,
    art: { id: string; version: number },
    planMeta: PlanMeta | null,
    stepCount: number,
    text: string,
    validationErrors: PlanValidationError[] = [],
    isComplex = false,
  ): RunOutcome {
    const branchNote = planMeta?.branches?.length
      ? ` (${planMeta.branches.length} branch${planMeta.branches.length > 1 ? "es" : ""})`
      : "";
    const stepNote = stepCount ? ` · ${stepCount} steps` : "";
    const malformed = validationErrors.length > 0;

    const output = this.outputSchema.parse({
      latestArtifact: art.id,
      version: art.version,
      branches: planMeta?.branches ?? undefined,
      steps: planMeta?.steps ?? undefined,
      ...(isComplex ? { complex: true } : {}),
      ...(malformed ? { malformed: true, validationErrors } : {}),
    });

    const status = malformed ? "failed" : "awaiting_approval";
    this.support.setNode(node.id, {
      status,
      agent_id: this.support.lastAgentId(node.id),
      output: JSON.stringify(output),
    });

    const kind = isComplex ? "complex plan" : "plan";
    const event = malformed
      ? `${kind} generated but response is malformed — fix the format and retry`
      : `${kind} v${art.version} ready for review${branchNote}${stepNote}`;
    db.emitEvent(ctx.flow.id, node.id, "lifecycle", event);

    return { status, output, event, reply: text };
  }

  override async chat(ctx: FlowCtx, content: string, model?: string): Promise<string> {
    const outcome = await this.run(
      ctx,
      this.inputSchema.parse({ feedback: content, model: model ?? null }),
      this.nodeConfig(ctx),
    );
    return outcome.reply;
  }

  async recover(
    ctx: FlowCtx,
    node: NodeRow,
    result: AgentRunResult,
    note: string,
  ): Promise<boolean> {
    // Phase A: scoped recovery is skipped — recover() can't distinguish a
    // scoped response from a whole-plan one, and a replayed scoped run must
    // not be silently merged. Decline so the node fails → the developer
    // retries (the retry stays scoped and re-enters the normal flow).
    try {
      const recorded = this.inputSchema.parse(node.input ?? {});
      if (recorded.branchRef) return false;
    } catch {
      /* unparseable input → fall through to whole-plan recovery */
    }

    if (result.status !== "finished") return false;
    const text = result.result ?? "(no plan text)";

    // Structured plan-meta parse is the only path: complex, then simple
    let planMeta: PlanMeta | null = null;
    let markdown = text;
    let isComplex = false;
    let parsedExecution: { execution?: unknown; execution_rationale?: unknown } | null = null;

    const complexParsed = this.parser.parseComplex(text);
    if (complexParsed.data) {
      planMeta = { steps: complexParsed.data.steps, branches: complexParsed.data.branches ?? [] };
      markdown = complexParsed.data.markdown;
      isComplex = true;
      parsedExecution = complexParsed.data;
    } else {
      const simpleParsed = this.parser.parseSimple(text);
      if (simpleParsed.data) {
        planMeta = { steps: simpleParsed.data.steps, branches: [] };
        markdown = simpleParsed.data.markdown;
        parsedExecution = simpleParsed.data;
      }
    }

    // recovery keeps the plan version's published execution too (Phase 3B): a
    // recovered response's planner decision rides the artifact meta so the
    // plan panel/chips and from-plan fan-out gates see the same resolution
    const recoveredExec = this.normalizePlannerExecution(parsedExecution);
    const art = this.support.saveArtifact(node.id, ctx.flow.id, "plan", markdown, {
      recovered: true,
      execution: recoveredExec.value,
      executionSource: recoveredExec.rationale ? "planner" : "default",
      ...(recoveredExec.rationale ? { execution_rationale: recoveredExec.rationale } : {}),
    });
    if (planMeta?.steps?.length) planSteps.syncFromPlan(ctx.flow.id, art.id, planMeta.steps);

    this.support.setNode(node.id, {
      status: planMeta ? "awaiting_approval" : "failed",
      output: JSON.stringify(
        this.outputSchema.parse({
          latestArtifact: art.id, version: art.version,
          steps: planMeta?.steps ?? undefined, branches: planMeta?.branches ?? undefined,
          ...(isComplex ? { complex: true } : {}),
          ...(planMeta ? {} : { malformed: true }),
        }),
      ),
    });
    db.emitEvent(
      ctx.flow.id, node.id, "lifecycle",
      `plan recovered (${note}) — ${planMeta ? "ready for review" : "malformed response, retry needed"}`,
    );
    return true;
  }

  // ── prompt previews (used by the prompt route) ────────────────────────────

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
  ): { prompt: string; contextBlocks: ContextBlockInfo[]; appendsInternal: true } | null {
    const scoped = this.prepareScopedRefine(ctx, { branchRef: branchName });
    if (!scoped) return null;
    const blocks = this.resolveContextBlocks(ctx, scoped);
    const vars = this.scopedVars(ctx, scoped, { feedback: "", contextBlocks: contextBlocks ?? [] });
    const prompt = prompts.renderUserTemplate("plan_subplan_refine", vars, { feedback: "" });
    return { prompt, contextBlocks: blocks, appendsInternal: true };
  }
}
