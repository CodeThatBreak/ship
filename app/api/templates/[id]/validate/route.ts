import { NextResponse } from "next/server";
import { templateStore, TemplateStore } from "../../../../../lib/engine/templates/template-store";
import {
  catalogForNodeTemplateIds,
  lintTemplate,
  type LintProblem,
} from "../../../../../lib/engine/templates/template-lint";
import { lintGraphStructure } from "../../../../../lib/engine/templates/graph-structure";
import { parseDeclarativeConfig } from "../../../../../lib/engine/nodes/declarative-schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Live validation (Phase 3): the editor's draft in — `{ trigger, nodes,
 * edges, new_node_templates? }`, the same shape the Save PATCH takes — the
 * static linter's problems out, structured (`where` / `ref` / `message`) so
 * the editor can underline the offending `{{ref}}` where it's typed instead
 * of surfacing everything at Save. No state is touched: lint only.
 *
 * Draft instances (`draft:<n>`, Phase 2) have no catalog row yet — their
 * pending defs ride in `new_node_templates` and synthesize catalog entries
 * here, exactly what the save path does with them before linting.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = templateStore.flowTemplate(id);
  if (!t) return NextResponse.json({ error: "template not found" }, { status: 404 });
  const body = await req.json().catch(() => null) as
    | null
    | {
        trigger?: Record<string, unknown>;
        nodes?: { key?: string; nodeTemplateId?: string; config?: unknown; input_map?: unknown; trigger?: unknown }[];
        edges?: { from?: string; to?: string; kind?: string; label?: string | null; condition?: string | null }[];
        new_node_templates?: { draft_id?: string; kind?: string; config?: unknown }[];
      };
  if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  const lintNodes = (body.nodes ?? []).map((n) => ({
    key: (typeof n.key === "string" ? n.key : "").trim(),
    nodeTemplateId: typeof n.nodeTemplateId === "string" ? n.nodeTemplateId : "",
    inputMap: (n.input_map ?? {}) as Record<string, unknown>,
    config: (n.config ?? {}) as Record<string, unknown>,
    trigger: n.trigger,
  }));

  const lintEdges = (body.edges ?? []).map((e) => ({
    from: e.from ?? "",
    to: e.to ?? "",
    kind: e.kind === "loop" ? "loop" : "next",
    label: e.label ?? null,
    condition: e.condition ?? null,
  }));

  // the catalog behind the draft: persisted rows resolved from the db, plus
  // the pending defs (key "" — never the start singleton)
  const realIds = lintNodes
    .map((n) => n.nodeTemplateId)
    .filter((id) => id && !id.startsWith("draft:"));
  const catalog = catalogForNodeTemplateIds(realIds);
  for (const d of body.new_node_templates ?? []) {
    if (typeof d?.draft_id === "string" && d.draft_id.startsWith("draft:")) {
      catalog[d.draft_id] = {
        kind: d.kind ?? "agent",
        config: d.config ?? {},
        key: "",
        isBuiltin: false,
      };
    }
  }

  const structureProblems = lintGraphStructure(lintNodes, lintEdges, (node) => {
    const entry = catalog[node.nodeTemplateId];
    if (!entry) return null;
    let decisionChoices: string[] | undefined;
    if (entry.kind === "decision") {
      const cfg = parseDeclarativeConfig("decision", { ...(entry.config ?? {}), ...(node.config ?? {}) }, node.key) as {
        choices?: { label: string }[];
      };
      decisionChoices = (cfg.choices ?? []).map((c) => c.label);
    }
    return {
      kind: entry.kind,
      key: entry.key,
      isBuiltin: entry.isBuiltin,
      decisionChoices,
    };
  });

  const trigger = TemplateStore.normalizeFlowTrigger(body.trigger);
  const task = TemplateStore.lintTaskUniverse(trigger);

  const lint = lintTemplate(lintNodes, lintEdges, catalog, task);

  const problems: LintProblem[] = [...structureProblems, ...lint.problems];

  return NextResponse.json({ problems });
}
