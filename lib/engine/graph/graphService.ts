import "server-only";

import { NotFoundError } from "@/lib/errors";
import { FlowRow, rows, type NodeTemplateRow } from "@/lib/db/rows";
import { nodeRegistry } from "@/lib/engine/nodes/registry";
import { outputFieldsFor } from "@/lib/engine/templates/templateLint";
import { templateStore } from "@/lib/engine/templates/templateStore";
import { processSingleton } from "@/lib/singleton";

export type GraphApiPayload = {
  templateId?: string;
  order: string[];
  meta: Record<string, unknown>;
  edges: readonly (readonly [string, string, string])[] | ReturnType<typeof nodeRegistry.edges>;
  edgeSpecs?: {
    from: string;
    to: string;
    kind: string;
    label: string | null;
    condition: string | null;
  }[];
};

export class GraphService {
  resolve(query: { flowId: string | null; templateId: string | null }): GraphApiPayload {
    const { flowId, templateId } = query;
    if (!flowId && !templateId) {
      return {
        order: nodeRegistry.order(),
        meta: nodeRegistry.meta(),
        edges: nodeRegistry.edges(),
      };
    }

    let resolvedTemplateId: string;
    if (templateId) {
      if (!templateStore.flowTemplate(templateId)) {
        throw new NotFoundError("template", templateId);
      }
      resolvedTemplateId = templateId;
    } else {
      const flow = rows.get(FlowRow, `SELECT * FROM flows WHERE id=?`, flowId ?? "");
      if (!flow) {
        throw new NotFoundError("flow", flowId ?? "");
      }
      if (!flow.template_id) {
        throw new NotFoundError("flow template", flowId ?? "");
      }
      resolvedTemplateId = flow.template_id;
    }

    const g = templateStore.graph(resolvedTemplateId);
    if (!g) {
      throw new NotFoundError("template", resolvedTemplateId);
    }

    const nts = new Map(templateStore.listNodeTemplates().map((nt) => [nt.id, nt]));
    return {
      templateId: g.templateId,
      order: g.nodes.map((n) => n.key),
      meta: Object.fromEntries(
        g.nodes.map((n) => {
          const nt = nts.get(n.nodeTemplateId) as NodeTemplateRow | undefined;
          const catalogConfig = (nt?.config ?? {}) as Record<string, unknown>;
          return [
            n.key,
            {
              label: n.label,
              kind: nt?.kind ?? null,
              icon: nt?.icon ?? null,
              name: nt?.name ?? n.label,
              trigger: n.trigger,
              join_mode: n.joinMode,
              outputs: outputFieldsFor(nt?.kind ?? "builtin", { ...catalogConfig, ...(n.config ?? {}) }),
            },
          ];
        }),
      ),
      edges: g.edges.map((e) => [e.from, e.to, e.kind] as const),
      edgeSpecs: g.edges.map((e) => ({
        from: e.from,
        to: e.to,
        kind: e.kind,
        label: e.label,
        condition: e.condition,
      })),
    };
  }
}

export const graphService = processSingleton(
  "graphService",
  () => new GraphService(),
);
