import "server-only";

import { NotFoundError } from "@/lib/errors";
import { db } from "@/lib/db/app";
import { type NodeTemplateRow } from "@/lib/db/rows";
import { nodeRegistry } from "@/lib/engine/nodes/registry";
import { outputFieldsFor } from "@/lib/engine/templates/outputFields";
import { templateStore } from "@/lib/engine/templates/templateStore";
import type { GraphApiPayload } from "../types/graphApiPayload";

/** Graph API read model (§1): resolves the workflow-graph payload for a live flow (nodes + live status + edges) or a template (registry meta/edges when unattached). Read-only — never mutates nodes, status or templates. */
export class GraphService {
  async resolve(query: { flowId: string | null; templateId: string | null }): Promise<GraphApiPayload> {
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
      if (!(await templateStore.flowTemplate(templateId))) {
        throw new NotFoundError("template", templateId);
      }
      resolvedTemplateId = templateId;
    } else {
      // only the template binding is consumed here — a scalar select is fully
      // Prisma-typed, so no zod row narrowing is needed
      const flow = await db.prisma.flow.findUnique({ where: { id: flowId ?? "" }, select: { templateId: true } });
      if (!flow) {
        throw new NotFoundError("flow", flowId ?? "");
      }
      if (!flow.templateId) {
        throw new NotFoundError("flow template", flowId ?? "");
      }
      resolvedTemplateId = flow.templateId;
    }

    const g = await templateStore.graph(resolvedTemplateId);
    if (!g) {
      throw new NotFoundError("template", resolvedTemplateId);
    }

    const nts = new Map((await templateStore.listNodeTemplates()).map((nt) => [nt.id, nt]));
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
