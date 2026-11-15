import "server-only";

import { db } from "@/lib/db/app";
import { buildFlowContext, type FlowContextMap } from "@/lib/engine/context/flowVariables";
import { flowEngine } from "@/lib/engine/flowEngine";
import { nodeRegistry } from "@/lib/engine/nodes/registry";
import { parseStartContract } from "@/lib/engine/nodes/kinds/start/contract";
import { taskRegistry } from "@/lib/engine/tasks/registry";
import { outputFieldsFor } from "@/lib/engine/templates/templateLint";
import { templateStore } from "@/lib/engine/templates/templateStore";
import { evalJsonata } from "@/lib/jsonata/eval";

type PreviewScope = "context" | "response" | "delivery";

const sampleValue = (type: unknown): unknown => {
  switch (type) {
    case "number":
      return 0;
    case "boolean":
      return true;
    case "object":
      return {};
    case "array":
      return [];
    default:
      return "";
  }
};

export class TemplatePreviewService {
  private async sampleContext(templateId: string): Promise<FlowContextMap> {
    const tpl = await db.get<{ trigger: unknown }>(
          `SELECT trigger FROM flow_templates WHERE id=$1`,
          templateId,
        );
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
    const nodeRows = await db.all<{ nodeKey: string; nodeTemplateId: string; config: unknown }>(
          `SELECT node_key AS "nodeKey", node_template_id AS "nodeTemplateId", config FROM flow_template_nodes WHERE template_id=$1`,
          templateId,
        );
    for (const r of nodeRows) {
      const nt = await db.get<{ kind: string; config: unknown }>(
              `SELECT kind, config FROM node_templates WHERE id=$1`,
              r.nodeTemplateId,
            );
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
    const row = await db.get<{ config: unknown }>(
          `SELECT n.config FROM flow_template_nodes n
     JOIN node_templates t ON t.id = n.node_template_id
     WHERE n.template_id=$1 AND t.key=$2`,
          templateId,
          entryKey,
        );
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
      const flow = await db.get<{ id: string }>(
              `SELECT id FROM flows WHERE template_id=$1 ORDER BY updated_at DESC LIMIT 1`,
              templateId,
            );
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

export const templatePreviewService = new TemplatePreviewService();
