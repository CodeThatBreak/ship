import "server-only";

import { db } from "../../../db/app";
import { FlowRow, Task, rows, NodeRow } from "../../../db/rows";
import { PROMPT_SOURCES } from "../../nodes/shared/nodeSharedExports";
import type { FlowCtx, NodeDefinition, PromptPreviewParams, PromptSource } from "../../nodes/shared/nodeSharedExports";
import { nodeRoles } from "../../nodes/shared/nodeRoles";
import { NODE_KEYS } from "../../constants/nodeKeys";
import { nodeRegistry } from "../../nodes/registry";
import { prompts } from "../promptLibrary";
import { sectionsOf } from "../promptLibrary/utils/sectionsOf";
import type { PromptSections, PromptTemplate } from "../promptLibrary/types/promptLibrary";
import { templateStore } from "../../templates/templateStore";
import type {
  AllPromptsResult,
  PromptFailure,
  PromptPreviewPayload,
  PromptPreviewResult,
} from "./types/promptPreview";

/** Prompt preview surface for the template editor (§1 read model): renders each node's effective prompt — source resolution, sections, live flow context — without executing anything. Read-only; never runs an agent or writes state. */
export class PromptPreview {
  async previewFor(flowId: string, url: URL): Promise<PromptPreviewResult> {
    const nodeKey = url.searchParams.get("node") ?? "";
    const params: PromptPreviewParams = {
      instructions: url.searchParams.get("instructions") ?? undefined,
      branch: url.searchParams.get("branch") ?? undefined,
    };

    const flow = await rows.get(FlowRow, `SELECT id, task_id AS "taskId", name, status, mr_url AS "mrUrl", mr_iid AS "mrIid", mr_branch AS "mrBranch", repo_url AS "repoUrl", gitlab_project_id AS "gitlabProjectId", execution_mode AS "executionMode", repo_id AS "repoId", template_id AS "templateId", template_graph AS "templateGraph", trigger_payload AS "triggerPayload", worktree_dir AS "worktreeDir", parent_flow_id AS "parentFlowId", kind, created_at AS "createdAt", updated_at AS "updatedAt" FROM flows WHERE id=$1`, flowId);
    if (!flow) return this.notFound("flow not found");
    const task = await rows.get(Task, `SELECT id, type, key, summary, description, status, issue_type AS "issueType", priority, repo_url AS "repoUrl", parent_key AS "parentKey", external_url AS "externalUrl", raw, synced_at AS "syncedAt", fields FROM tasks WHERE id=$1`, flow.taskId);
    if (!task) return this.notFound("task not found");
    const repo = flow.repoId ? await db.repoById(flow.repoId) ?? null : null;
    const ctx: FlowCtx = { flow, task, repo };

    const node = await rows.get(NodeRow, `SELECT id, flow_id AS "flowId", node_key AS "nodeKey", type, status, attempt_id AS "attemptId", agent_id AS "agentId", agent_ref AS "agentRef", session_id AS "sessionId", label, config, join_mode AS "joinMode", input, output, created_at AS "createdAt", updated_at AS "updatedAt" FROM nodes WHERE flow_id=$1 AND node_key=$2`, flowId, nodeKey) ?? null;
    const def = await this.defFor(flowId, nodeKey, node);
    // §T4: the preview role is routed through the role router — defs without
    // a previewable prompt (the start def) decline; the declarative
    // agent/decision kinds publish theirs via the shared assembly (step 05).
    const previewer = nodeRoles.promptPreviewerOf(def);
    const preview = previewer ? await previewer.previewPrompt(ctx, node, params) : null;
    if (!preview) {
      if (params.branch && nodeKey === NODE_KEYS.PLAN) {
        return this.bad(`branch "${params.branch}" not found in the latest plan — sub-plan refine unavailable`);
      }
      return this.bad(`unsupported node: ${nodeKey}`);
    }

    const sections = sectionsOf(preview.assembly);
    const payload = await this.payload({
      sections,
      templateKey: preview.templateKey,
      configBody: preview.configBody,
      bodySource: preview.configBody != null ? "config" : "default",
      appendsInternal: this.templateOf(preview.templateKey).internalBlocks.length > 0,
      ctx,
      nodeKey,
    });
    return { ok: true, payload };
  }

  /**
   * The composer's bulk prompt read: every promptable node's editable body
   * (the same live resolution one node's preview does) keyed by node key —
   * one bounded fetch instead of one per node. Nodes whose def declines a
   * preview (defs with no prompt surface, e.g. start) are skipped, matching
   * the single-node route's rejection of unsupported nodes.
   */
  async allFor(flowId: string): Promise<AllPromptsResult> {
    const flow = await rows.get(FlowRow, `SELECT id, task_id AS "taskId", name, status, mr_url AS "mrUrl", mr_iid AS "mrIid", mr_branch AS "mrBranch", repo_url AS "repoUrl", gitlab_project_id AS "gitlabProjectId", execution_mode AS "executionMode", repo_id AS "repoId", template_id AS "templateId", template_graph AS "templateGraph", trigger_payload AS "triggerPayload", worktree_dir AS "worktreeDir", parent_flow_id AS "parentFlowId", kind, created_at AS "createdAt", updated_at AS "updatedAt" FROM flows WHERE id=$1`, flowId);
    if (!flow) return this.notFound("flow not found");
    const task = await rows.get(Task, `SELECT id, type, key, summary, description, status, issue_type AS "issueType", priority, repo_url AS "repoUrl", parent_key AS "parentKey", external_url AS "externalUrl", raw, synced_at AS "syncedAt", fields FROM tasks WHERE id=$1`, flow.taskId);
    if (!task) return this.notFound("task not found");
    const repo = flow.repoId ? await db.repoById(flow.repoId) ?? null : null;
    const ctx: FlowCtx = { flow, task, repo };

    const prompts: Record<string, string> = {};
    for (const node of await rows.all(NodeRow, `SELECT id, flow_id AS "flowId", node_key AS "nodeKey", type, status, attempt_id AS "attemptId", agent_id AS "agentId", agent_ref AS "agentRef", session_id AS "sessionId", label, config, join_mode AS "joinMode", input, output, created_at AS "createdAt", updated_at AS "updatedAt" FROM nodes WHERE flow_id=$1`, flowId)) {
      const def = await this.defFor(flowId, node.nodeKey, node);
      const previewer = nodeRoles.promptPreviewerOf(def);
      const preview = previewer ? await previewer.previewPrompt(ctx, node, {}) : null;
      if (!preview) continue;
      prompts[node.nodeKey] = sectionsOf(preview.assembly).body;
    }
    return { ok: true, prompts };
  }

  private async notFound(error: string): Promise<PromptFailure> {
    return { ok: false, status: 404, error };
  }

  private async bad(error: string): Promise<PromptFailure> {
    return { ok: false, status: 400, error };
  }

  /** The def for a node instance — same resolution the engine's retry path uses. */
  private async defFor(flowId: string, nodeKey: string, node: NodeRow | null): Promise<NodeDefinition> {
    const spec = (await templateStore.graphForFlow(flowId))?.byKey.get(nodeKey);
    return nodeRegistry.resolve(spec?.defKey ?? node?.type ?? nodeKey, nodeKey);
  }

  /** Assemble the modal payload for one node row's resolution + last-run overlay. */
  private async payload(input: {
    sections: PromptSections;
    templateKey: string;
    configBody: string | null;
    bodySource: PromptPreviewPayload["bodySource"];
    appendsInternal: boolean;
    ctx: FlowCtx;
    nodeKey: string;
  }): Promise<PromptPreviewPayload> {
    const tpl = this.templateOf(input.templateKey);
    const node = await rows.get(NodeRow, `SELECT id, flow_id AS "flowId", node_key AS "nodeKey", type, status, attempt_id AS "attemptId", agent_id AS "agentId", agent_ref AS "agentRef", session_id AS "sessionId", label, config, join_mode AS "joinMode", input, output, created_at AS "createdAt", updated_at AS "updatedAt" FROM nodes WHERE flow_id=$1 AND node_key=$2`, input.ctx.flow.id, input.nodeKey);
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

    // the why (step 05): when every non-run-data section of the current
    // resolution still appears verbatim in the recorded prompt, only the
    // run-data slots differ; anything else means the template resolution
    // itself moved (a template edit or a config body change) — and if
    // nothing diverges there is no reason to report
    const diverges = lastRun != null && lastRun !== input.sections.final;
    const templateSections = [
      input.sections.body,
      input.sections.engineRules,
      input.sections.outputContract,
    ].filter((s) => s.trim());
    const divergesReason = diverges
      ? templateSections.every((s) => lastRun.includes(s))
        ? ("run-data" as const)
        : ("template-edited" as const)
      : undefined;

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
      engineRules: input.sections.engineRules,
      outputContract: input.sections.outputContract,
      runData: input.sections.runData,
      final: input.sections.final,
      finalChars: input.sections.final.length,
      // last-run overlay
      lastRun,
      diverges,
      ...(divergesReason ? { divergesReason } : {}),
      promptSource,
    };
  }

  /**
   * The template metadata a preview's key resolves to — synthesized for the
   * declarative kinds (agent/decision, step 05), whose prompts live in their
   * template row's config instead of the library: the modal then shows the
   * kind name and an empty metadata set rather than crashing on a missing
   * library entry.
   */
  private templateOf(templateKey: string): PromptTemplate {
    return (
      prompts.getTemplate(templateKey) ?? {
        label: templateKey,
        description: "",
        variables: [],
        mode: "agent",
        userTemplate: "",
        internalBlocks: [],
      }
    );
  }
}
