import { toErrorResponse } from "@/lib/errors";
import { parseJson } from "@/lib/http/parse";
import { nodeTemplateCreateBodySchema } from "@/lib/schemas/node-template";
import { NextResponse } from "next/server";
import { templateStore } from "../../../lib/engine/templates/template-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The node-type catalog (built-ins + declarative), for the builder palette. */
export const GET = async (req: Request) => {
  const templateId = new URL(req.url).searchParams.get("templateId") ?? undefined;
  const payload = templateStore.paletteCatalog(templateId);
  return NextResponse.json(payload);
};

/** Create a declarative node template (Phase 2: kind=agent). */
const KIND_LABELS: Record<string, string> = {
  agent: "Agent node",
  decision: "Decision node",
  http: "HTTP node",
  script: "Script node",
};

export const POST = async (req: Request) => {
  try {
    const body = await parseJson(req, nodeTemplateCreateBodySchema);
    let name = (body.name ?? "").trim();
    let description = body.description ?? null;
    const kind = body.kind ?? "agent";
    if (!name) {
      const label = KIND_LABELS[kind] ?? "Custom node";
      description ??= `Blank ${kind} node — connect it, then author it in the drawer`;
      for (let n = 1; ; n++) {
        const candidate = n === 1 ? label : `${label} ${n}`;
        const slug = candidate.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "node";
        if (!templateStore.nodeTemplateByKey(slug)) {
          name = candidate;
          break;
        }
      }
    }
    const nt = templateStore.createNodeTemplate({
      key: body.key,
      name,
      kind,
      icon: body.icon ?? null,
      description,
      config: body.config ?? {},
    });
    return NextResponse.json({ nodeTemplate: { ...nt, is_builtin: Boolean(nt.is_builtin) } });
  } catch (e: unknown) {
    return toErrorResponse(e);
  }
};
