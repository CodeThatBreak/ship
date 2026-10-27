import { NextResponse } from "next/server";
import { templateStore } from "../../../../../lib/engine/templates/template-store";
import {
  catalogForNodeTemplateIds,
  lintTemplate,
  type LintProblem,
} from "../../../../../lib/engine/templates/template-lint";
import { taskRegistry } from "../../../../../lib/engine/tasks/registry";

export const dynamic = "force-dynamic";

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
        nodes?: { key?: string; nodeTemplateId?: string; config?: unknown; input_map?: unknown }[];
        edges?: { from?: string; to?: string; kind?: string; label?: string | null; condition?: string | null }[];
        new_node_templates?: { draft_id?: string; kind?: string; config?: unknown }[];
      };
  if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 });

  // the catalog behind the draft: persisted rows resolved from the db, plus
  // the pending defs (key "" — never the start singleton)
  const realIds = (body.nodes ?? [])
    .map((n) => (typeof n.nodeTemplateId === "string" ? n.nodeTemplateId : ""))
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

  // the {{task.*}} universe (mirrors TemplateStore.taskUniverse — the
  // declared task type's provider contextFields; unknown → null free pass)
  const taskType = String(body.trigger?.task_type ?? "");
  const provider = taskRegistry.maybe(taskType);
  const task = provider
    ? { kind: provider.kind, fields: provider.contextFields.map((f) => ({ key: f.key, label: f.label })) }
    : null;

  const problems: LintProblem[] = lintTemplate(
    (body.nodes ?? []).map((n) => ({
      key: (typeof n.key === "string" ? n.key : "").trim(),
      nodeTemplateId: typeof n.nodeTemplateId === "string" ? n.nodeTemplateId : "",
      inputMap: (n.input_map ?? {}) as Record<string, unknown>,
      config: (n.config ?? {}) as Record<string, unknown>,
    })),
    (body.edges ?? []).map((e) => ({
      from: e.from ?? "",
      to: e.to ?? "",
      kind: e.kind === "loop" ? "loop" : "next",
      label: e.label ?? null,
      condition: e.condition ?? null,
    })),
    catalog,
    task,
  ).problems;

  return NextResponse.json({ problems });
}
