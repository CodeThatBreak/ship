import "server-only";

import { db } from "@/lib/db";
import { buildFlowContext, type FlowContextMap } from "@/lib/engine/context/flow-variables";
import { flowEngine } from "@/lib/engine/flow-engine";
import { nodeRegistry } from "@/lib/engine/nodes/registry";
import { parseStartContract } from "@/lib/engine/nodes/kinds/start/contract";
import { taskRegistry } from "@/lib/engine/tasks/registry";
import { outputFieldsFor } from "@/lib/engine/templates/template-lint";
import { templateStore } from "@/lib/engine/templates/template-store";
import { evalJsonata } from "@/lib/jsonata";

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
  private sampleContext(templateId: string): FlowContextMap {
    const tpl = db.get<{ trigger: string | null }>(
      `SELECT trigger FROM flow_templates WHERE id=?`,
      templateId,
    );
    const trigger = (() => {
      try {
        return tpl?.trigger ? JSON.parse(tpl.trigger) : {};
      } catch {
        return {};
      }
    })() as Record<string, unknown>;

    const provider = taskRegistry.maybe(String(trigger.task_type ?? ""));
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
    const nodeRows = db.all<{ node_key: string; node_template_id: string; config: string | null }>(
      `SELECT node_key, node_template_id, config FROM flow_template_nodes WHERE template_id=?`,
      templateId,
    );
    for (const r of nodeRows) {
      const nt = db.get<{ kind: string; config: string | null }>(
        `SELECT kind, config FROM node_templates WHERE id=?`,
        r.node_template_id,
      );
      if (!nt) continue;
      let instConfig: unknown = {};
      try {
        instConfig = r.config ? JSON.parse(r.config) : {};
      } catch {
        instConfig = {};
      }
      let defConfig: unknown = {};
      try {
        defConfig = nt.config ? JSON.parse(nt.config) : {};
      } catch {
        defConfig = {};
      }
      const merged = {
        ...(defConfig as Record<string, unknown>),
        ...(instConfig as Record<string, unknown>),
      };
      const fields = outputFieldsFor(nt.kind, merged);
      nodes[r.node_key] = {
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

  private sampleTriggerPayload(templateId: string): Record<string, unknown> {
    const entryKey = nodeRegistry.entryKey();
    const row = db.get<{ config: string | null }>(
      `SELECT n.config FROM flow_template_nodes n
     JOIN node_templates t ON t.id = n.node_template_id
     WHERE n.template_id=? AND t.key=?`,
      templateId,
      entryKey,
    );
    if (!row?.config) return {};
    let config: unknown = {};
    try {
      config = JSON.parse(row.config);
    } catch {
      return {};
    }
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
    | { ok: true; value: unknown; source: "run" | "sample" }
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
      const flow = db.get<{ id: string }>(
        `SELECT id FROM flows WHERE template_id=? ORDER BY updated_at DESC LIMIT 1`,
        templateId,
      );
      if (flow) {
        try {
          context = buildFlowContext(flowEngine.ctx(flow.id));
          source = "run";
        } catch {
          /* sample fallback */
        }
      }
      if (!context) context = this.sampleContext(templateId);
    } else if (scope === "response") {
      context = {
        status: 200,
        ok: true,
        body: { message: "sample response" },
        headers: { "content-type": "application/json" },
      };
    } else {
      context = {
        payload: this.sampleTriggerPayload(templateId),
        headers: { "content-type": "application/json" },
      };
    }

    const r = await evalJsonata(expr, context);
    if (!r.ok) {
      return { ok: false, error: r.error ?? "expression failed", source };
    }
    return { ok: true, value: r.value ?? null, source };
  }

  assertTemplateExists(templateId: string): boolean {
    return Boolean(templateStore.flowTemplate(templateId));
  }
}

export const templatePreviewService = new TemplatePreviewService();
