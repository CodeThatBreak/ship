import "server-only";

import { db } from "../../db";
import { FlowRow, Task, rows, NodeRow } from "../../db/rows";
import { PROMPT_SOURCES } from "../nodes/shared";
import type { FlowCtx, NodeDefinition, NodePromptPreview, PromptPreviewParams, PromptSource } from "../nodes/shared";
import { nodeRoles } from "../nodes/shared/node-roles";
import { NODE_KEYS } from "../constants/node-keys";
import { nodeRegistry } from "../nodes/registry";
import type { ContextBlockInfo } from "../nodes/kinds/plan/types/contextBlocks";
import { prompts, sectionsOf, type PromptSections } from "./prompt-library";
import { templateStore } from "../templates/template-store";

/**
 * The prompt modal's truth layer (Phase 1): the live prompt resolution —
 * assembled by the node def's own `previewPrompt` from its template + config
 * knobs — plus the last-run overlay read from `nodes.input.prompt`.
 *
 * The modal never shows a stale per-run "override" instead of the live
 * resolution (the veto the old route gave `nodes.prompt_override` is gone):
 * the response carries BOTH the current final prompt and what the last run
 * actually sent, with a `diverges` flag so the UI can flag the difference.
 */

/** The full modal payload: back-compat fields plus the three-part sections. */
export interface PromptPreviewPayload {
  // back-compat: the editable body (the modal's textarea seed / reset target)
  prompt: string;
  label: string;
  description: string;
  variables: string[];
  mode: string;
  source: "template";
  appendsInternal: boolean;
  // three-part sections
  bodySource: "config" | "default";
  userRules: string;
  engineRules: string;
  outputContract: string;
  runData: PromptSections["runData"];
  final: string;
  finalChars: number;
  // the node's config key the modal saves the rules box into (set_node_config)
  rulesKey: string;
  // last-run overlay (Phase 1): what run N actually sent, read from
  // nodes.input.prompt, and whether it diverges from the current resolution
  lastRun: string | null;
  diverges: boolean;
  /** where the last run's prompt came from (recorded for agent kinds, inferred from the config knob for built-ins) */
  promptSource: PromptSource;
  // sub-plan refine picker (branch-scoped plan previews)
  contextBlocks?: ContextBlockInfo[];
}

export type PromptPreviewResult =
  | { ok: true; payload: PromptPreviewPayload }
  | { ok: false; status: number; error: string };

/** The plan node's branch-scoped preview (§7.2) — structurally typed. */
interface SubPlanPreviewer {
  previewSubPlanPrompt(
    ctx: FlowCtx,
    branchName: string,
    contextBlocks?: string[],
  ): { prompt: string; contextBlocks: ContextBlockInfo[]; appendsInternal: true } & PromptSections | null;
}

export class PromptPreview {
  previewFor(flowId: string, url: URL): Promise<PromptPreviewResult> {
    const nodeKey = url.searchParams.get("node") ?? "";
    const params: PromptPreviewParams = {
      feedback: url.searchParams.get("feedback") ?? undefined,
      instructions: url.searchParams.get("instructions") ?? undefined,
      branch: url.searchParams.get("branch") ?? undefined,
      contextBlocks: url.searchParams.get("contextBlocks")?.split(",").filter(Boolean) ?? undefined,
    };

    const flow = rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, flowId);
    if (!flow) return this.notFound("flow not found");
    const task = rows.get(Task, `SELECT * FROM tasks WHERE id=?`, flow.task_id);
    if (!task) return this.notFound("task not found");
    const repo = flow.repo_id ? db.repoById(flow.repo_id) ?? null : null;
    const ctx: FlowCtx = { flow, task, repo };

    // ── branch-scoped sub-plan refine prompt (§7.2) ──────────────────────────
    // Resolves `plan_subplan_refine` (editable body + the three-part sections)
    // and the context block list so the PromptModal can render the picker.
    if (params.branch && nodeKey === NODE_KEYS.PLAN) {
      // the branch-scoped preview is the plan def's own special method
      const planDef = nodeRegistry.get(NODE_KEYS.PLAN) as unknown as SubPlanPreviewer;
      const preview = planDef.previewSubPlanPrompt(ctx, params.branch, params.contextBlocks);
      if (!preview) {
        return this.bad(`branch "${params.branch}" not found in the latest plan — sub-plan refine unavailable`);
      }
      const payload = this.payload({
        sections: preview,
        templateKey: "plan_subplan_refine",
        configBody: null,
        bodySource: "default",
        rulesKey: "prompt_rules",
        appendsInternal: true,
        ctx,
        nodeKey,
        contextBlocks: preview.contextBlocks,
      });
      return Promise.resolve({ ok: true, payload });
    }

    const node = rows.get(NodeRow, `SELECT * FROM nodes WHERE flow_id=? AND node_key=?`, flowId, nodeKey) ?? null;
    const def = this.defFor(flowId, nodeKey, node);
    // §T4: the preview role is routed through the role router — defs without
    // a previewable prompt (agent kinds leave it to the phase-2 work) decline.
    const previewer = nodeRoles.promptPreviewerOf(def);
    const preview: NodePromptPreview | null = previewer ? previewer.previewPrompt(ctx, node, params) : null;
    if (!preview) {
      return this.bad(`unsupported node: ${nodeKey}`);
    }

    const sections = sectionsOf(preview.assembly);
    const payload = this.payload({
      sections,
      templateKey: preview.templateKey,
      configBody: preview.configBody,
      bodySource: preview.configBody != null ? "config" : "default",
      rulesKey: preview.templateKey === "pipeline_fix" ? "fix_prompt_rules" : "prompt_rules",
      appendsInternal: prompts.getTemplate(preview.templateKey).internalBlocks.length > 0,
      ctx,
      nodeKey,
    });
    return Promise.resolve({ ok: true, payload });
  }

  private async notFound(error: string): Promise<PromptPreviewResult> {
    return { ok: false, status: 404, error };
  }

  private async bad(error: string): Promise<PromptPreviewResult> {
    return { ok: false, status: 400, error };
  }

  /** The def for a node instance — same resolution the engine's retry path uses. */
  private defFor(flowId: string, nodeKey: string, node: NodeRow | null): NodeDefinition {
    const spec = templateStore.graphForFlow(flowId)?.byKey.get(nodeKey);
    return nodeRegistry.resolve(spec?.defKey ?? node?.type ?? nodeKey, nodeKey);
  }

  /** Assemble the modal payload for one node row's resolution + last-run overlay. */
  private payload(input: {
    sections: PromptSections;
    templateKey: string;
    configBody: string | null;
    bodySource: PromptPreviewPayload["bodySource"];
    rulesKey: string;
    appendsInternal: boolean;
    ctx: FlowCtx;
    nodeKey: string;
    contextBlocks?: ContextBlockInfo[];
  }): PromptPreviewPayload {
    const tpl = prompts.getTemplate(input.templateKey);
    const node = rows.get(NodeRow, `SELECT * FROM nodes WHERE flow_id=? AND node_key=?`, input.ctx.flow.id, input.nodeKey);
    const recordedInput = node?.input ?? null;
    // the last run's prompt: what run N actually sent — every run records the
    // exact final text into nodes.input.prompt (build/step-build/review/
    // resolve/plan via execute(), agent kinds as the rendered prompt)
    const lastRun =
      typeof recordedInput?.prompt === "string" && recordedInput.prompt.trim()
        ? (recordedInput.prompt as string)
        : null;
    const recordedSource =
      typeof recordedInput?.prompt_source === "string" && (PROMPT_SOURCES as readonly string[]).includes(recordedInput.prompt_source)
        ? (recordedInput.prompt_source as PromptSource)
        : null;
    const promptSource: PromptSource =
      recordedSource ??
      (input.configBody != null ? "config" : "default");

    return {
      prompt: input.sections.body,
      label: tpl.label,
      description: tpl.description,
      variables: tpl.variables,
      mode: tpl.mode,
      source: "template",
      appendsInternal: input.appendsInternal,
      // three-part sections
      bodySource: input.bodySource,
      userRules: input.sections.userRules,
      engineRules: input.sections.engineRules,
      outputContract: input.sections.outputContract,
      runData: input.sections.runData,
      final: input.sections.final,
      finalChars: input.sections.final.length,
      // the node's config key the modal saves the rules box into (set_node_config)
      rulesKey: input.rulesKey,
      // last-run overlay
      lastRun,
      diverges: lastRun != null && lastRun !== input.sections.final,
      promptSource,
      ...(input.contextBlocks !== undefined ? { contextBlocks: input.contextBlocks } : {}),
    };
  }
}

export const promptPreview = new PromptPreview();
