import "server-only";

import { db } from "@/lib/db/app";
import { buildFlowContext, type FlowContextMap } from "@/lib/engine/context/flowVariables";
import { flowEngine } from "@/lib/engine/flowEngine";
import { nodeRegistry } from "@/lib/engine/nodes/registry";
import { parseStartContract } from "@/lib/engine/nodes/kinds/start/contract";
import { taskRegistry } from "@/lib/engine/tasks/registry";
import { outputFieldsFor } from "@/lib/engine/templates/outputFields";
import { templateStore } from "@/lib/engine/templates/templateStore";
import { evalJsonata } from "@/lib/jsonata/eval";
import type { PreviewScope } from "./types/previewScope";
import { sampleValue } from "./utils/sampleValue";

/** Template preview (§1 read model): samples a start-contract context and evaluates the template's nodes/edges to preview a hypothetical run — variables, outputs, edges. Read-only: samples synthetic values, never writes flows/nodes. */
export class TemplatePreviewService {
  private async sampleContext(templateId: string): Promise<FlowContextMap> {
    const tpl = await db.prisma.flowTemplate.findFirst({
      where: { id: templateId },
      select: { trigger: true },
    });
    const trigger = (tpl?.trigger ?? {}) as Record<string, unknown>;

    const provider = taskRegistry.maybe(String(trigger.taskType ?? ""));
    const task: Record<string, unknown> = {
      key: "TASK-1",
      summary: "Sample task",
      description: "",
      status: "",
      priority: "",
      issue_type: "",
      repo_url: "",
      parent_key: "",
      url: "",
      type: provider?.kind ?? "",
      ...Object.fromEntries(
        (provider?.contextFields ?? []).map((f) => [f.key, sampleValue(f.type)]),
      ),
    };

    const nodes: Record<string, { output: unknown }> = {};
    const nodeRows = await db.prisma.flowTemplateNode.findMany({
      where: { templateId },
      select: { nodeKey: true, nodeTemplateId: true, config: true },
    });
    for (const r of nodeRows) {
      const nt = await db.prisma.nodeTemplate.findFirst({
        where: { id: r.nodeTemplateId },
        select: { kind: true, config: true },
      });
      if (!nt) continue;
      const instConfig: unknown = r.config ?? {};
      const defConfig: unknown = nt.config ?? {};
      const merged = {
        ...(defConfig as Record<string, unknown>),
        ...(instConfig as Record<string, unknown>),
      };
      const fields = outputFieldsFor(nt.kind, merged);
      nodes[r.nodeKey] = {
        output:
          fields == null
            ? {}
            : Object.fromEntries(fields.map((f) => [f, sampleValue("string")])),
      };
    }

    return {
      task,
      repo: {
        cloud_url: "https://git.example.com/acme/widgets",
        local_path: "/workspaces/widgets",
      },
      flow: {
        mr_url: "https://git.example.com/acme/widgets/-/merge_requests/42",
        mr_branch: "sample/branch",
      },
      trigger: { payload: this.sampleTriggerPayload(templateId) },
      nodes,
    };
  }

  private async sampleTriggerPayload(templateId: string): Promise<Record<string, unknown>> {
    const entryKey = nodeRegistry.entryKey();
    if (entryKey == null) return {};
    const row = await db.prisma.flowTemplateNode.findFirst({
      where: { templateId, nodeTemplate: { key: entryKey } },
      select: { config: true },
    });
    if (row?.config == null) return {};
    const config: unknown = row.config;
    return Object.fromEntries(
      parseStartContract(config).map((f) => [
        f.key,
        f.default !== undefined ? f.default : sampleValue(f.type),
      ]),
    );
  }

  async evaluate(
    templateId: string,
    input: { expr: string; scope: PreviewScope },
  ): Promise<
    { ok: true; value: unknown; source: "run" | "sample" }
    | { ok: false; error: string; source: "run" | "sample" }
    | { ok: true; value: undefined; source: "sample" }
  > {
    const { expr, scope } = input;
    if (!expr.trim()) {
      return { ok: true, value: undefined, source: "sample" };
    }

    let context: unknown;
    let source: "run" | "sample" = "sample";
    if (scope === "context") {
      const flow = await db.prisma.flow.findFirst({
        where: { templateId },
        orderBy: { updatedAt: "desc" },
        select: { id: true },
      });
      if (flow) {
        try {
          context = await buildFlowContext(await flowEngine.ctx(flow.id));
          source = "run";
        } catch {
          /* sample fallback */
        }
      }
      if (!context) context = await this.sampleContext(templateId);
    } else if (scope === "response") {
      context = {
        status: 200,
        ok: true,
        body: { message: "sample response" },
        headers: { "content-type": "application/json" },
      };
    } else {
      context = {
        payload: await this.sampleTriggerPayload(templateId),
        headers: { "content-type": "application/json" },
      };
    }

    const r = await evalJsonata(expr, context);
    if (!r.ok) {
      return { ok: false, error: r.error ?? "expression failed", source };
    }
    return { ok: true, value: r.value ?? null, source };
  }

  async assertTemplateExists(templateId: string): Promise<boolean> {
    return Boolean(await templateStore.flowTemplate(templateId));
  }
}
