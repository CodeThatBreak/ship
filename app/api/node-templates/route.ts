import { NextResponse } from "next/server";
import { templateStore } from "../../../lib/engine/templates";
import type { NodeTemplateRow } from "../../../lib/db/rows";

export const dynamic = "force-dynamic";

/** The shared API response fields for one catalog entry (locality included). */
function serializeNodeTemplate(nt: NodeTemplateRow) {
  return {
    id: nt.id,
    key: nt.key,
    name: nt.name,
    kind: nt.kind,
    version: nt.version,
    description: nt.description,
    icon: nt.icon,
    is_builtin: Boolean(nt.is_builtin),
    config: nt.config,
    template_id: nt.template_id,
    is_local: Boolean(nt.template_id),
    created_at: nt.created_at,
    updated_at: nt.updated_at,
  };
}

/** The node-type catalog (built-ins + declarative), for the builder palette.
 *  `?templateId=<id>` splits the declarative rows by locality: `nodeTemplates`
 *  carries built-ins + the global Library rows, `templateNodeTemplates` the
 *  rows private to that template (the palette's "This template" section).
 *  Without the query the unscoped shape (every row in `nodeTemplates`) holds. */
export async function GET(req: Request) {
  const templateId = new URL(req.url).searchParams.get("templateId") ?? undefined;
  if (templateId === undefined) {
    const nodeTemplates = templateStore.listNodeTemplates().map(serializeNodeTemplate);
    return NextResponse.json({ nodeTemplates });
  }
  const { library, templateLocal } = templateStore.listNodeTemplatesForPalette(templateId);
  return NextResponse.json({
    nodeTemplates: [
      ...templateStore.listNodeTemplates().filter((nt) => Boolean(nt.is_builtin)).map(serializeNodeTemplate),
      ...library.map(serializeNodeTemplate),
    ],
    templateNodeTemplates: templateLocal.map(serializeNodeTemplate),
  });
}

/** Create a declarative node template (Phase 2: kind=agent).
 *  A create without a name (the palette's one-click add) is auto-named per
 *  kind — "Agent node", "Agent node 2", … — the first free slug wins. */
const KIND_LABELS: Record<string, string> = {
  agent: "Agent node",
  decision: "Decision node",
  http: "HTTP node",
  script: "Script node",
};

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as null | {
    key?: string; name?: string; kind?: string; icon?: string | null;
    description?: string | null; config?: Record<string, unknown>;
  };
  if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  let name = (body.name ?? "").trim();
  let description = body.description ?? null;
  if (!name) {
    const label = KIND_LABELS[body.kind ?? ""] ?? "Custom node";
    description ??= `Blank ${body.kind ?? ""} node — connect it, then author it in the drawer`;
    for (let n = 1; ; n++) {
      const candidate = n === 1 ? label : `${label} ${n}`;
      const slug = candidate.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "node";
      if (!templateStore.nodeTemplateByKey(slug)) {
        name = candidate;
        break;
      }
    }
  }
  try {
    const nt = templateStore.createNodeTemplate({
      key: body.key,
      name,
      kind: body.kind ?? "agent",
      icon: body.icon ?? null,
      description,
      config: body.config ?? {},
    });
    return NextResponse.json({ nodeTemplate: { ...nt, is_builtin: Boolean(nt.is_builtin) } });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
