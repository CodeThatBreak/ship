import { NextResponse } from "next/server";
import { templateStore, type TemplateInput, type TemplateNodeInput, type TemplateEdgeInput } from "../../../../lib/engine/templates";
import { hookStore } from "../../../../lib/engine/hooks";

export const dynamic = "force-dynamic";

function notFound() {
  return NextResponse.json({ error: "template not found" }, { status: 404 });
}

/**
 * A draft declarative node template (Phase 2): the palette's kind tiles place
 * in-memory instances (`node_template_id: "draft:<n>"`) — nothing server-side
 * exists until Save. The Save PATCH carries the pending defs; rows are created
 * here first, the `draft:` ids are remapped to the real row ids, and the
 * existing save path (lint included) runs on the remapped graph. Atomic from
 * the client's view: any failure rolls back the rows created in this call.
 */
interface NewNodeTemplateInput {
  draft_id?: string;
  name?: string;
  kind?: string;
  icon?: string | null;
  description?: string | null;
  config?: Record<string, unknown>;
}

/** The full editor payload: template meta + node instances + edges. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = templateStore.flowTemplate(id);
  if (!t) return notFound();
  const g = templateStore.graph(id);
  if (!g) return notFound();
  // the flow-trigger hook (always provisioned, §6) — url path + secret for
  // the sender's curl example
  const hook = hookStore.hookForTemplate(id);
  return NextResponse.json({
    template: {
      id: t.id,
      name: t.name,
      description: t.description,
      version: t.version,
      is_builtin: t.is_builtin,
      trigger: g.flowTrigger,
    },
    hook: hook ? { id: hook.id, secret: hook.secret, filter: hook.filter } : null,
    nodes: g.nodes.map((n) => {
      const nt = templateStore.nodeTemplate(n.nodeTemplateId);
      return {
        key: n.key,
        node_template_id: n.nodeTemplateId,
        label: n.label,
        trigger: n.trigger,
        join_mode: n.joinMode,
        config: n.config,
        input_map: n.inputMap,
        kind: nt?.kind ?? null,
        icon: nt?.icon ?? null,
        catalog_name: nt?.name ?? null,
        /** node_templates row key ("plan"/"start"/...): the fan-out UI gates
         *  on builtin plan nodes the same way the save-time lint does */
        catalog_key: nt?.key ?? null,
        is_builtin: Boolean(nt?.is_builtin),
        is_local: Boolean(nt?.template_id),
        x: n.x ?? null,
        y: n.y ?? null,
      };
    }),
    edges: g.edges,
  });
}

/** Meta patch; node/edge arrays replace the whole graph (the editor draft). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null) as
    | null
    | (Partial<TemplateInput> & {
        nodes?: TemplateNodeInput[];
        edges?: TemplateEdgeInput[];
        positions?: Record<string, { x: number; y: number }>;
        new_node_templates?: NewNodeTemplateInput[];
      });
  if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  /** rows created by this call — rolled back if anything downstream fails, so
   *  a rejected save (lint error, running flows, …) leaves no orphan rows */
  const createdRows: string[] = [];
  try {
    // positions-only drag sync (Phase 5): display metadata, no graph rewrite
    if (body.positions && body.nodes === undefined && body.edges === undefined) {
      templateStore.updatePositions(id, body.positions);
      return NextResponse.json({ ok: true });
    }
    const drafts = Array.isArray(body.new_node_templates) ? body.new_node_templates : [];
    if (drafts.length) {
      createdRows.push(...applyDraftNodeTemplates(id, body, drafts));
    } else if (
      body.nodes?.some((n) => typeof n.nodeTemplateId === "string" && n.nodeTemplateId.startsWith("draft:"))
    ) {
      return NextResponse.json(
        { error: "a node references an unsaved node template — send it in new_node_templates" },
        { status: 400 },
      );
    }
    delete body.new_node_templates;
    templateStore.update(id, body);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    for (const rowId of createdRows) {
      try { templateStore.deleteNodeTemplate(rowId); } catch { /* keep rolling back */ }
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

/**
 * Create the pending defs' rows and remap every `draft:<n>` node template id
 * to the created row id. `templateId` scopes the created rows to the saving
 * template — the canvas creator's defs stay private to it until the user
 * explicitly adds them to the Library. Returns the ids of rows created by
 * this call (the caller rolls them back if anything downstream fails). Any
 * failure — a bad config, an unknown draft reference — throws before the save
 * runs.
 */
function applyDraftNodeTemplates(
  templateId: string,
  body: { nodes?: TemplateNodeInput[] },
  drafts: NewNodeTemplateInput[],
): string[] {
  if (!body.nodes) {
    throw new Error("new_node_templates requires the nodes array (a full graph save)");
  }
  const created: string[] = [];
  const byDraftId = new Map<string, string>();
  for (const d of drafts) {
    const draftId = typeof d?.draft_id === "string" ? d.draft_id : "";
    if (!draftId.startsWith("draft:")) {
      throw new Error("new_node_templates entry is missing its draft_id");
    }
    if (byDraftId.has(draftId)) continue; // two entries for one draft — first wins
    const { id: rowId, created: isNew } = templateStore.createOrReuseNodeTemplate({
      name: (d.name ?? "").trim() || "Untitled node",
      kind: d.kind ?? "agent",
      icon: d.icon ?? null,
      description: d.description ?? null,
      config: d.config ?? {},
    }, { templateId });
    if (isNew) created.push(rowId);
    byDraftId.set(draftId, rowId);
  }
  body.nodes = body.nodes.map((n) => {
    const ntId = typeof n.nodeTemplateId === "string" ? n.nodeTemplateId : "";
    if (!ntId.startsWith("draft:")) return n;
    const rowId = byDraftId.get(ntId);
    if (!rowId) {
      throw new Error(`node "${n.key}" references unsaved node template "${ntId}" — it wasn't included in new_node_templates`);
    }
    return { ...n, nodeTemplateId: rowId };
  });
  return created;
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    templateStore.delete(id);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
