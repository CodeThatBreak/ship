import { NextResponse } from "next/server";
import { db } from "../../../../../lib/db";
import { FlowRow, Task, rows } from "../../../../../lib/db/rows";
import { prompts, sectionsOf, type PromptSections } from "../../../../../lib/engine/prompts";
import { appLayerConfig, configString, mergeConfigLayers } from "../../../../../lib/engine/node-config";
import { flowCtxHelper, type FlowCtx } from "../../../../../lib/engine/nodes/base";
import { nodeRegistry } from "../../../../../lib/engine/nodes/registry";
import { PlanNode } from "../../../../../lib/engine/nodes/plan/plan-node";
import { NODE_KEYS } from "../../../../../lib/engine/nodes/keys";
import type { NodeRow } from "../../../../../lib/db/rows";

export const dynamic = "force-dynamic";

/** The flow node's effective config (app-settings layer + the live snapshot) for prompt preview. */
function effectiveConfig(defKey: string, node: NodeRow | null): Record<string, unknown> {
  return mergeConfigLayers(appLayerConfig(defKey), node?.config ?? null);
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  const nodeKey = url.searchParams.get("node") ?? "";
  const feedback = url.searchParams.get("feedback") ?? undefined;
  const instructions = url.searchParams.get("instructions") ?? undefined;
  const branchParam = url.searchParams.get("branch") ?? undefined;
  const contextBlocksParam = url.searchParams.get("contextBlocks");
  const contextBlocks = contextBlocksParam ? contextBlocksParam.split(",").filter(Boolean) : undefined;

  // ── branch-scoped sub-plan refine prompt (§7.2) ────────────────────────────
  // Resolves `plan_subplan_refine` (editable body + the three-part sections)
  // and the context block list so the PromptModal can render the picker.
  if (branchParam && nodeKey === NODE_KEYS.PLAN) {
    const flow = rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, id);
    if (!flow) return NextResponse.json({ error: "flow not found" }, { status: 404 });
    const task = rows.get(Task, `SELECT * FROM tasks WHERE id=?`, flow.task_id);
    if (!task) return NextResponse.json({ error: "task not found" }, { status: 404 });
    const repo = flow.repo_id ? db.repoById(flow.repo_id) ?? null : null;
    const ctx: FlowCtx = { flow, task, repo };
    // the branch-scoped preview is PlanNode-specific — resolve its def via the registry
    const planDef = nodeRegistry.get(NODE_KEYS.PLAN) as PlanNode;
    const preview = planDef.previewSubPlanPrompt(ctx, branchParam, contextBlocks);
    if (!preview) {
      return NextResponse.json(
        { error: `branch "${branchParam}" not found in the latest plan — sub-plan refine unavailable` },
        { status: 400 },
      );
    }
    const tpl = prompts.getTemplate("plan_subplan_refine");
    return NextResponse.json(sectionedResponse({
      sections: preview,
      label: tpl.label,
      description: tpl.description,
      variables: tpl.variables,
      mode: tpl.mode,
      source: "template",
      appendsInternal: true,
      bodySource: "default",
      rulesKey: "prompt_rules",
      contextBlocks: preview.contextBlocks,
    }));
  }

  // the pipeline gate node renders the shared fix template
  let templateNodeKey = nodeKey === NODE_KEYS.PIPELINE ? "pipeline_fix" : nodeKey;
  if (!prompts.isValidNodeKey(templateNodeKey)) {
    return NextResponse.json({ error: `unknown node key: ${nodeKey}` }, { status: 400 });
  }

  const flow = rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, id);
  if (!flow) return NextResponse.json({ error: "flow not found" }, { status: 404 });
  const task = rows.get(Task, `SELECT * FROM tasks WHERE id=?`, flow.task_id);
  if (!task) return NextResponse.json({ error: "task not found" }, { status: 404 });
  const repo = flow.repo_id ? db.repoById(flow.repo_id) ?? null : null;
  const node = db.get<NodeRow>(`SELECT * FROM nodes WHERE flow_id=? AND node_key=?`, id, nodeKey) ?? null;

  const ctx: FlowCtx = { flow, task, repo };
  const mode = flow.execution_mode === "local" ? "local" : "cloud";
  const branch = flow.mr_branch ?? flowCtxHelper.buildBranch(ctx);
  const taskCtx = flowCtxHelper.taskContext(ctx);
  const config = effectiveConfig(nodeKey, node);

  // per-node prompt override wins — shown verbatim (the user owns it entirely;
  // nothing is appended on the run either)
  if (node?.prompt_override) {
    const overrideTpl = prompts.getTemplate(templateNodeKey);
    return NextResponse.json({
      prompt: node.prompt_override,
      label: overrideTpl.label,
      description: overrideTpl.description,
      variables: overrideTpl.variables,
      mode: overrideTpl.mode,
      source: "override",
      appendsInternal: false,
    });
  }

  // Per-node body/rules knobs (prompt_body / prompt_rules — fix_prompt_* on
  // the pipeline gate): the preview shows the CONFIGURED body when one is set
  // so the modal can never show a stale default, plus the three-part sections
  // (engine rules, locked output contract, run data) and the final assembled
  // prompt — exactly what the run will send.
  let body: string | undefined;
  const ctxVars: Record<string, string | undefined> = {};
  const extra: Record<string, string | undefined> = {};

  switch (nodeKey) {
    case NODE_KEYS.PLAN: {
      // feedback refine preview (follow-up on the plan agent): the full
      // body-only refine template with the feedback rendered in
      if (feedback && node?.agent_id) {
        templateNodeKey = "plan_refine";
        extra.feedback = feedback;
        ctxVars.ticket = taskCtx;
      } else {
        body = configString(config, "prompt_body");
        ctxVars.ticket = taskCtx;
        ctxVars.ticket_type = flowCtxHelper.taskLabel(ctx);
      }
      break;
    }
    case NODE_KEYS.BUILD: {
      const planRow = db.all<{ content: string }>(
        `SELECT a.content FROM artifacts a JOIN nodes n ON n.id=a.node_id
         WHERE n.flow_id=? AND a.kind='plan' ORDER BY a.version DESC LIMIT 1`, id)[0];
      const planContent = planRow?.content ?? "(no plan yet)";
      const instr = mode === "local"
        ? `Implement the following approved plan for a ${flowCtxHelper.taskLabel(ctx)} ticket. First create and check out a new git branch named "${branch}" (from the repo's default branch), then make the code changes, commit them, and push the branch to origin. Do NOT open a merge request.`
        : `Implement the following approved plan for a ${flowCtxHelper.taskLabel(ctx)} ticket. Make the code changes, commit them, and push to a feature branch. Do NOT open a merge request yet.`;
      // build's body knob is a verbatim prompt override; the default preview
      // resolves the full template (plan + checklist are the body here)
      body = configString(config, "prompt_body") ??
        prompts.resolve(NODE_KEYS.BUILD, { ticket: taskCtx, branch, mode }, { instructions: instr, plan: planContent });
      break;
    }
    case NODE_KEYS.PIPELINE: {
      body = configString(config, "fix_prompt_body");
      extra.guidance = instructions ? `Developer guidance: ${instructions}` : "";
      extra.instructions = mode === "local" ? `Start by checking out branch ${branch}.` : "";
      break;
    }
    case NODE_KEYS.REVIEW: {
      body = configString(config, "prompt_body");
      // fill the contract/run-data sections with what's knowable now —
      // the diff is finalized at run time
      ctxVars.ticket_key = ctx.task.key;
      ctxVars.ticket_type = flowCtxHelper.taskLabel(ctx);
      ctxVars.ticket_summary = ctx.task.summary ?? "";
      ctxVars.ticket_prd = ctx.task.prdText?.slice(0, 4000) ?? "";
      extra.instructions = instructions ? `Extra review focus from the developer: ${instructions}` : "";
      break;
    }
    case NODE_KEYS.RESOLVE: {
      body = configString(config, "prompt_body");
      extra.dev_instructions = instructions ? `Developer instructions: ${instructions}` : "";
      extra.instructions = mode === "local" ? `Start by checking out branch ${branch}.` : "";
      break;
    }
    default:
      return NextResponse.json({ error: `unsupported node: ${nodeKey}` }, { status: 400 });
  }

  // the template metadata comes from the key the switch settled on
  // (plan feedback refines preview the plan_refine template)
  const tpl = prompts.getTemplate(templateNodeKey);

  const userRules = configString(config, templateNodeKey === "pipeline_fix" ? "fix_prompt_rules" : "prompt_rules") ?? "";
  const asm = prompts.assemblePrompt(templateNodeKey, ctxVars, extra, { body, userRules });
  return NextResponse.json(sectionedResponse({
    sections: sectionsOf(asm),
    label: tpl.label,
    description: tpl.description,
    variables: tpl.variables,
    mode: tpl.mode,
    source: "template",
    appendsInternal: tpl.internalBlocks.length > 0,
    bodySource: body != null && configString(config, templateNodeKey === "pipeline_fix" ? "fix_prompt_body" : "prompt_body") != null ? "config" : "default",
    rulesKey: templateNodeKey === "pipeline_fix" ? "fix_prompt_rules" : "prompt_rules",
  }));
}

/** The full modal payload: back-compat fields plus the three-part sections. */
function sectionedResponse({
  sections,
  label,
  description,
  variables,
  mode,
  source,
  appendsInternal,
  bodySource,
  rulesKey,
  contextBlocks,
}: {
  sections: PromptSections;
  label: string;
  description: string;
  variables: string[];
  mode: string;
  source: string;
  appendsInternal: boolean;
  bodySource: "config" | "default";
  rulesKey: string;
  contextBlocks?: unknown;
}) {
  return {
    // back-compat: the editable body (the modal's textarea seed / reset target)
    prompt: sections.body,
    label,
    description,
    variables,
    mode,
    source,
    appendsInternal,
    // three-part sections
    bodySource,
    userRules: sections.userRules,
    engineRules: sections.engineRules,
    outputContract: sections.outputContract,
    runData: sections.runData,
    final: sections.final,
    finalChars: sections.final.length,
    // the node's config key the modal saves the rules box into (set_node_config)
    rulesKey,
    ...(contextBlocks !== undefined ? { contextBlocks } : {}),
  };
}
