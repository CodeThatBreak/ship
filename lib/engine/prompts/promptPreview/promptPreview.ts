import "server-only";

import { db } from "../../../db/app";
import { FlowRow, Task, NodeRow } from "../../../db/rows";
import { parseRow, parseRows } from "@/lib/db/ormRowHelpers";
import { PROMPT_SOURCES } from "../../nodes/shared/nodeSharedExports";
import type { FlowCtx, NodeDefinition, PromptPreviewParams, PromptSource } from "../../nodes/shared/nodeSharedExports";
import { nodeRoles } from "../../nodes/shared/nodeRoles";
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
    };

    const flowRow = await db.prisma.flow.findUnique({ where: { id: flowId } });
    if (!flowRow) return this.notFound("flow not found");
    const flow = parseRow(FlowRow, flowRow, `flow ${flowId}`);
    const taskRow = await db.prisma.task.findUnique({ where: { id: flow.taskId } });
    if (!taskRow) return this.notFound("task not found");
    const task = parseRow(Task, taskRow, `task ${flow.taskId}`);
    const repo = flow.repoId ? await db.repoById(flow.repoId) ?? null : null;
    const ctx: FlowCtx = { flow, task, repo };

    const nodeRow = await db.prisma.node.findUnique({ where: { flowId_nodeKey: { flowId, nodeKey } } });
    const node = nodeRow ? parseRow(NodeRow, nodeRow, `node ${nodeKey} of flow ${flowId}`) : null;
    const def = await this.defFor(flowId, nodeKey, node);
    // §T4: the preview role is routed through the role router — defs without
    // a previewable prompt (the start def) decline; the declarative
    // agent/decision kinds publish theirs via the shared assembly (step 05).
    const previewer = nodeRoles.promptPreviewerOf(def);
    const preview = previewer ? await previewer.previewPrompt(ctx, node, params) : null;
    if (!preview) {
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
    const flowRow = await db.prisma.flow.findUnique({ where: { id: flowId } });
    if (!flowRow) return this.notFound("flow not found");
    const flow = parseRow(FlowRow, flowRow, `flow ${flowId}`);
    const taskRow = await db.prisma.task.findUnique({ where: { id: flow.taskId } });
    if (!taskRow) return this.notFound("task not found");
    const task = parseRow(Task, taskRow, `task ${flow.taskId}`);
    const repo = flow.repoId ? await db.repoById(flow.repoId) ?? null : null;
    const ctx: FlowCtx = { flow, task, repo };

    const prompts: Record<string, string> = {};
    for (const node of parseRows(NodeRow, await db.prisma.node.findMany({ where: { flowId } }), `nodes of flow ${flowId}`)) {
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
    const nodeRow = await db.prisma.node.findUnique({
      where: { flowId_nodeKey: { flowId: input.ctx.flow.id, nodeKey: input.nodeKey } },
    });
    const node = nodeRow
      ? parseRow(NodeRow, nodeRow, `node ${input.nodeKey} of flow ${input.ctx.flow.id}`)
      : null;
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
