import { NextResponse } from "next/server";
import { db } from "../../../../../lib/db";
import { FlowRow, Ticket, rows } from "../../../../../lib/db/rows";
import { prompts } from "../../../../../lib/engine/prompts";
import { flowCtxHelper, nodeSupport, type FlowCtx } from "../../../../../lib/engine/nodes/base";
import { NODE_KEYS } from "../../../../../lib/engine/nodes/keys";
import { previewSubPlanPrompt } from "../../../../../lib/engine/nodes/plan";

export const dynamic = "force-dynamic";

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
  // Resolves `plan_subplan_refine` (editable body only) + the context block
  // list so the PromptModal can render the picker (id, label, preview, char
  // count, default-on, locked).
  if (branchParam && nodeKey === NODE_KEYS.PLAN) {
    const flow = rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, id);
    if (!flow) return NextResponse.json({ error: "flow not found" }, { status: 404 });
    const ticket = rows.get(Ticket, `SELECT * FROM tickets WHERE id=?`, flow.ticket_id);
    if (!ticket) return NextResponse.json({ error: "ticket not found" }, { status: 404 });
    const repo = flow.repo_id ? db.repoById(flow.repo_id) ?? null : null;
    const ctx: FlowCtx = { flow, ticket, repo };
    const preview = previewSubPlanPrompt(ctx, branchParam, contextBlocks);
    if (!preview) {
      return NextResponse.json(
        { error: `branch "${branchParam}" not found in the latest plan — sub-plan refine unavailable` },
        { status: 400 },
      );
    }
    const tpl = prompts.getTemplate("plan_subplan_refine");
    return NextResponse.json({
      prompt: preview.prompt,
      label: tpl.label,
      description: tpl.description,
      variables: tpl.variables,
      mode: tpl.mode,
      source: "template",
      appendsInternal: true,
      contextBlocks: preview.contextBlocks,
    });
  }

  // the pipeline gate node renders the shared fix template
  const templateNodeKey = nodeKey === NODE_KEYS.PIPELINE ? "pipeline_fix" : nodeKey;
  if (!prompts.isValidNodeKey(templateNodeKey)) {
    return NextResponse.json({ error: `unknown node key: ${nodeKey}` }, { status: 400 });
  }

  const flow = rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, id);
  if (!flow) return NextResponse.json({ error: "flow not found" }, { status: 404 });
  const ticket = rows.get(Ticket, `SELECT * FROM tickets WHERE id=?`, flow.ticket_id);
  if (!ticket) return NextResponse.json({ error: "ticket not found" }, { status: 404 });
  const repo = flow.repo_id ? db.repoById(flow.repo_id) ?? null : null;
  const node = nodeSupport.nodeByKey(id, nodeKey);

  const ctx: FlowCtx = { flow, ticket, repo };
  const mode = flow.execution_mode === "local" ? "local" : "cloud";
  const branch = flow.mr_branch ?? flowCtxHelper.buildBranch(ctx);
  const ticketCtx = flowCtxHelper.ticketContext(ctx);

  // per-node prompt override wins — shown verbatim (the user owns it entirely)
  if (node?.prompt_override) {
    const tpl = prompts.getTemplate(templateNodeKey);
    return NextResponse.json({
      prompt: node.prompt_override,
      label: tpl.label,
      description: tpl.description,
      variables: tpl.variables,
      mode: tpl.mode,
      source: "override",
      appendsInternal: false,
    });
  }

  // Template-sourced prompts: show only the user-editable body. Internal
  // instructions (output-format contracts, workflow rules) are omitted here
  // and re-appended by the node at run time — editing them could break the
  // output the code parses.
  let prompt: string;
  let templateKey = nodeKey;

  switch (nodeKey) {
    case NODE_KEYS.PLAN: {
      const hasAgent = Boolean(node?.agent_id);
      if (feedback && hasAgent) {
        templateKey = "plan_refine";
        prompt = prompts.resolve("plan_refine", { ticket: ticketCtx }, { feedback });
      } else {
        prompt = prompts.renderUserTemplate(NODE_KEYS.PLAN, { ticket: ticketCtx });
      }
      break;
    }
    case NODE_KEYS.BUILD: {
      const planRow = db.all<{ content: string }>(
        `SELECT a.content FROM artifacts a JOIN nodes n ON n.id=a.node_id
         WHERE n.flow_id=? AND a.kind='plan' ORDER BY a.version DESC LIMIT 1`, id)[0];
      const planContent = planRow?.content ?? "(no plan yet)";
      const instr = mode === "local"
        ? `Implement the following approved plan for a Jira ticket. First create and check out a new git branch named "${branch}" (from the repo's default branch), then make the code changes, commit them, and push the branch to origin. Do NOT open a merge request.`
        : `Implement the following approved plan for a Jira ticket. Make the code changes, commit them, and push to a feature branch. Do NOT open a merge request yet.`;
      prompt = prompts.resolve(NODE_KEYS.BUILD,
        { ticket: ticketCtx, branch, mode },
        { instructions: instr, plan: planContent },
      );
      break;
    }
    case NODE_KEYS.PIPELINE: {
      // the gate's fix-run prompt — guidance for the fix agent
      templateKey = "pipeline_fix";
      prompt = prompts.renderUserTemplate("pipeline_fix", {},
        { guidance: instructions ? `Developer guidance: ${instructions}` : "" });
      break;
    }
    case NODE_KEYS.REVIEW: {
      prompt = prompts.renderUserTemplate(NODE_KEYS.REVIEW, {},
        { instructions: instructions ? `Extra review focus from the developer: ${instructions}` : "" });
      break;
    }
    case NODE_KEYS.RESOLVE: {
      prompt = prompts.renderUserTemplate(NODE_KEYS.RESOLVE, {},
        { dev_instructions: instructions ? `Developer instructions: ${instructions}` : "" });
      break;
    }
    default:
      return NextResponse.json({ error: `unsupported node: ${nodeKey}` }, { status: 400 });
  }

  const tpl = prompts.getTemplate(templateKey);
  const appendsInternal = templateKey !== "plan_refine" && Boolean(DEFAULT_USER_TEMPLATES.has(templateKey));
  return NextResponse.json({
    prompt,
    label: tpl.label,
    description: tpl.description,
    variables: tpl.variables,
    mode: tpl.mode,
    source: "template",
    appendsInternal,
  });
}

/** Template keys whose prompt modal body gets internal instructions appended at run time. */
const DEFAULT_USER_TEMPLATES: Set<string> = new Set([
  NODE_KEYS.PLAN,
  "pipeline_fix",
  NODE_KEYS.REVIEW,
  NODE_KEYS.RESOLVE,
]);
